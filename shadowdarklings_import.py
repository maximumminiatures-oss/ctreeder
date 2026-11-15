"""Bounded browser import, isolated from the web process and its credentials."""
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import threading
import requests
from urllib.parse import urlsplit

CREATE_URL = "https://shadowdarklings.net/create"
SOURCE_SWITCHES = ("Scroll #1", "Scroll #2", "Scroll #3", "Scroll #4", "B&R&K",
    "Roustabout", "Unnatural Selection", "Darcy")
SOURCE_IDS = {
    "Scroll #1": "flexSwitchCheckDefaultCS1",
    "Scroll #2": "flexSwitchCheckDefaultCS2",
    "Scroll #3": "flexSwitchCheckDefaultCS3",
    "Scroll #4": "flexSwitchCheckDefaultCS4",
    "B&R&K": "flexSwitchCheckDefaultSG",
    "Roustabout": "flexSwitchCheckDefaultRB",
    "Unnatural Selection": "flexSwitchCheckDefaultUS",
    "Darcy": "flexSwitchCheckDefaultDP",
}
ALLOWED_HOSTS = {"shadowdarklings.net", "www.shadowdarklings.net", "fonts.googleapis.com",
    "fonts.gstatic.com", "cdn.jsdelivr.net", "cdnjs.cloudflare.com"}
CORE_ANCESTRIES = ("Dwarf", "Elf", "Goblin", "Halfling", "Half-Orc", "Human")
CORE_CLASSES = ("Fighter", "Priest", "Thief", "Wizard")


def import_options(data):
    result = {}
    if "mode" in data:
        if data["mode"] not in ("random-1", "best-fit", "random-0", "random-4x0"):
            raise ValueError("Invalid character generation mode.")
        result["mode"] = data["mode"]
    for key, allowed in (("ancestries", CORE_ANCESTRIES), ("classes", CORE_CLASSES)):
        if key not in data:
            continue
        values = data[key]
        if (not isinstance(values, list) or not values or len(values) > len(allowed)
                or any(not isinstance(value, str) or value not in allowed for value in values)
                or len(set(values)) != len(values)):
            raise ValueError(f"Select at least one valid option for {key}.")
        result[key] = values
    return result


def validate_export(result, mode=None):
    if not isinstance(result, str) or len(result.encode("utf-8")) > MAX_IMPORT_BYTES:
        raise ValueError("Invalid character export")
    data = json.loads(result)
    if mode == "random-4x0":
        if not isinstance(data, list) or len(data) != 4 or not all(isinstance(item, dict) for item in data):
            raise ValueError("Invalid four-character export")
    elif not isinstance(data, dict):
        raise ValueError("Invalid character export")
    return data


MAX_IMPORT_BYTES = 128 * 1024
IMPORT_PROCESS_TIMEOUT_SECONDS = 30
IMPORT_WORKER_HARD_TIMEOUT_SECONDS = 35
IMPORT_SERVICE_TIMEOUT_SECONDS = 38
IMPORT_SERVICE_HOSTS = {"importer", "127.0.0.1", "localhost"}


def stop_import_process(process, *, force_tree=False):
    is_running = process.poll() is None
    if not is_running and not (force_tree and os.name != "nt"):
        return
    if os.name == "nt":
        taskkill = Path(os.environ["SYSTEMROOT"]) / "System32" / "taskkill.exe"
        try:
            subprocess.run([str(taskkill), "/PID", str(process.pid), "/T", "/F"],
                capture_output=True, timeout=5, creationflags=subprocess.CREATE_NO_WINDOW)
        except (OSError, subprocess.TimeoutExpired):
            process.kill()
    else:
        try:
            os.killpg(process.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
    try:
        process.wait(timeout=5)
    except subprocess.TimeoutExpired:
        process.kill()
        process.wait(timeout=5)


def start_worker_deadline():
    """Kill the isolated worker group even if its Gunicorn parent disappears."""
    if os.name == "nt" or os.environ.get("SD_IMPORT_ISOLATED_PROCESS") != "1":
        return None

    def stop_worker_group():
        try:
            os.killpg(os.getpgrp(), signal.SIGKILL)
        except OSError:
            os._exit(1)

    timer = threading.Timer(IMPORT_WORKER_HARD_TIMEOUT_SECONDS, stop_worker_group)
    timer.daemon = True
    timer.start()
    return timer


def fetch_remote_character_json(service_url, base_classes_only, **options):
    target = urlsplit(service_url)
    if (target.scheme != "http" or target.hostname not in IMPORT_SERVICE_HOSTS or
            target.username or target.password or target.query or target.fragment):
        raise RuntimeError("The configured character import service URL is invalid.")
    try:
        response = requests.post(
            service_url,
            json={"base_classes_only": bool(base_classes_only), **options},
            timeout=(2, IMPORT_SERVICE_TIMEOUT_SECONDS),
        )
        data = response.json()
    except (requests.RequestException, ValueError) as exc:
        raise RuntimeError("The character import service is unavailable.") from exc
    if response.status_code != 200 or not isinstance(data, dict):
        raise RuntimeError("The character import service could not generate a character.")
    result = data.get("character_json")
    try:
        validate_export(result, options.get("mode"))
    except (TypeError, ValueError) as exc:
        raise RuntimeError("The character import service returned an invalid character.") from exc
    return result


def run_shadowdarklings_import_worker(base_classes_only=False, **options):
    allowed_environment = {"PATH", "SYSTEMROOT", "WINDIR", "TEMP", "TMP", "HOME", "LANG", "PLAYWRIGHT_BROWSERS_PATH"}
    environment = {key: value for key, value in os.environ.items() if key.upper() in allowed_environment}
    environment["SD_IMPORT_SANDBOX"] = "1" if os.environ.get("FLASK_ENV") == "production" else "0"
    environment["SD_IMPORT_ISOLATED_PROCESS"] = "1"
    command = [sys.executable, str(Path(__file__).resolve()), "--worker"]
    if base_classes_only:
        command.append("--base-only")
    if options:
        command.extend(["--options", json.dumps(options)])
    process_options = {"creationflags": subprocess.CREATE_NO_WINDOW | subprocess.CREATE_NEW_PROCESS_GROUP} if os.name == "nt" else {"start_new_session": True}
    process = subprocess.Popen(command, env=environment, stdin=subprocess.DEVNULL,
        stdout=subprocess.PIPE, stderr=subprocess.PIPE, **process_options)
    try:
        output, error_output = process.communicate(timeout=IMPORT_PROCESS_TIMEOUT_SECONDS)
        if process.returncode or len(output) > MAX_IMPORT_BYTES:
            detail = (error_output or b"").decode("utf-8", errors="replace").strip()[-1000:]
            suffix = f" Worker reported: {detail}" if detail else ""
            raise RuntimeError(f"Shadowdarklings import is temporarily unavailable.{suffix}")
        result = output.decode("utf-8").strip()
        validate_export(result, options.get("mode"))
        return result
    except subprocess.TimeoutExpired as exc:
        raise RuntimeError("Shadowdarklings import timed out. Please try again later.") from exc
    except (ValueError, UnicodeError) as exc:
        raise RuntimeError("Shadowdarklings returned an invalid character.") from exc
    finally:
        stop_import_process(process, force_tree=getattr(process, "returncode", None) not in {None, 0})
        process.stdout.close()
        process.stderr.close()


def fetch_shadowdarklings_character_json(base_classes_only=False, **options):
    service_url = os.environ.get("SHADOWDARKLINGS_IMPORT_URL", "").strip()
    if service_url:
        return fetch_remote_character_json(service_url, base_classes_only, **options)
    return run_shadowdarklings_import_worker(base_classes_only, **options)


def browser_import(base_classes_only, mode="random-1", ancestries=None, classes=None):
    from playwright.sync_api import sync_playwright
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True,
            chromium_sandbox=os.environ.get("SD_IMPORT_SANDBOX") == "1", timeout=15000)
        try:
            context = browser.new_context(viewport={"width": 1280, "height": 1440},
                accept_downloads=False, service_workers="block")
            context.set_default_timeout(8000)
            def allow_source(route):
                target = urlsplit(route.request.url)
                if route.request.resource_type in {"font", "image", "media"}:
                    route.abort()
                    return
                if target.scheme == "https" and target.hostname in ALLOWED_HOSTS and target.port in {None, 443}:
                    route.continue_()
                else:
                    route.abort()
            context.route("**/*", allow_source)
            context.grant_permissions(["clipboard-read", "clipboard-write"], origin=CREATE_URL)
            page = context.new_page()
            page.goto(CREATE_URL, wait_until="domcontentloaded", timeout=20000)
            zero = mode in ("random-0", "random-4x0")
            generation = page.get_by_role("button", name="Random 0" if zero else "Random 1", exact=True)
            generation.first.click()
            for label in SOURCE_SWITCHES:
                try:
                    page.locator(f"#{SOURCE_IDS[label]}").first.set_checked(not base_classes_only, timeout=1000)
                except Exception:
                    try:
                        page.get_by_role("switch", name=label).set_checked(not base_classes_only, timeout=500)
                    except Exception:
                        continue
            if ancestries is not None or classes is not None:
                page.get_by_role("button", name="Filter Ancestries & Classes").click()
                for prefix, allowed, selected in (("anc", CORE_ANCESTRIES, ancestries), ("class", CORE_CLASSES, classes)):
                    if selected is None:
                        continue
                    for index, name in enumerate(allowed):
                        page.locator(f'[id="{prefix}_{name}_{index}"]:visible').last.set_checked(name in selected)
                page.keyboard.press("Escape")
                # Both responsive copies can be present. Only the visible close button is actionable.
                dialog = page.get_by_role("dialog")
                if dialog.count() and dialog.last.is_visible():
                    dialog.last.get_by_role("button", name="Close").click()
            if not zero:
                page.get_by_role("button", name="Best Fit" if mode == "best-fit" else "Full Random", exact=True).click()
            generate = (page.get_by_role("button", name="Random 0", exact=True).last if zero
                        else page.get_by_role("button", name="Generate a Random Character"))
            characters = []
            for _ in range(4 if mode == "random-4x0" else 1):
                generate.click()
                page.evaluate("navigator.clipboard.writeText('')")
                page.get_by_role("button", name="JSON", exact=True).click()
                page.wait_for_function("""async () => {
                    const text = (await navigator.clipboard.readText()).trim();
                    return text.startsWith('{') && text.endsWith('}');
                }""", timeout=3000)
                result = page.evaluate("navigator.clipboard.readText()").strip()
                character = validate_export(result)
                if ((zero and character.get("level") != 0)
                        or ancestries is not None and character.get("ancestry") not in ancestries
                        or not zero and classes is not None and character.get("class") not in classes):
                    raise ValueError("ShadowDarklings generated a character outside the selected filters.")
                characters.append(character)
            result = json.dumps(characters if mode == "random-4x0" else characters[0])
            validate_export(result, mode)
            return result
        finally:
            browser.close()


if __name__ == "__main__" and "--worker" in sys.argv:
    deadline = start_worker_deadline()
    try:
        options = import_options(json.loads(sys.argv[sys.argv.index("--options") + 1])) if "--options" in sys.argv else {}
        sys.stdout.buffer.write(browser_import("--base-only" in sys.argv, **options).encode("utf-8"))
    except Exception as exc:
        detail = " ".join(str(exc).split())[:1000]
        print(f"{type(exc).__name__}: {detail}", file=sys.stderr)
        sys.exit(1)
    finally:
        if deadline is not None:
            deadline.cancel()

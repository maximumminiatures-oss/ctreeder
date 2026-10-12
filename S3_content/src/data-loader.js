const localJsonLoads = new Map();

export function loadLocalJson(url) {
  if (!localJsonLoads.has(url)) {
    const pending = fetch(url).then(response => {
      if (!response.ok) throw new Error(`Local data request failed: ${response.status} (${url})`);
      return response.json();
    }).catch(error => {
      localJsonLoads.delete(url);
      throw error;
    });
    localJsonLoads.set(url, pending);
  }
  return localJsonLoads.get(url);
}

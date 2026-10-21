import { DEFAULT_LIGHT_RADIUS, MAX_SEARCH_MODIFIER, MIN_SEARCH_MODIFIER, TILE_SIZE_PX } from "./constants.js";
import { loadLocalJson } from './data-loader.js';
import { formatRulesMessage } from './rules-message.js';
import { generateDungeon } from "./generator.js";
import { buildNextLevelState, dungeonArrivalPositions, dungeonDescentStatus, downstairsIn } from './dungeon-descent.js';
import { createSaveMenus } from './save-menus.js';
import { isTied, grapplingEscapeOption, escapePitWithGrapplingHook, ropeBridgeOptions, buildRopeBridge, tieTargets, tieWithRope, escapeRope } from './rope-actions.js';
import { createDoorEntity } from './state-schema.js';
import { SeededRng } from './rng.js';
import {
  addMonsterLootDrop,
  clickEntity,
  collectLoot,
  collectRoomLoot,
  canMoveBetweenTiles,
  defeatMonster,
  disarmTrap,
  dropLootAtPlayer,
  attemptLockedDoor,
  getPendingLockedDoorAction,
  getDoorClickContext,
  getDoorBetween, getDoorAt, setDoorState,
  getRoomLoot,
  getRoomTraps,
  movePlayer,
  rollCheck,
  searchForTraps, partyCanReachLoot, partyInLootArea
} from "./interactions.js";
import { formatTreasureValue } from "./treasure.js";
import { sheetLore, talentPresentation } from './sheet-lore.js';
import { fieldLore } from './sheet-field-lore.js';
import { canCastFeatherFall, queueFallingDamage, resolveFallingDamage } from './falling.js';
import { magicBonus, revealedMagicBonus, magicSaleValue, drinkPotion, giantStrengthActive, advancePotionRounds, queueScrollLearning,
  enchantedEquipment, magicPotion, magicScroll, magicTreasureCatalog } from './magic-items.js';
import { WIZARD_TIER_ONE, WIZARD_CRITICAL_CHOICES, castWizardTierOne, resolveWizardTierOne, maintainDetectMagic,
  refreshMagicDetection, canIdentify, identifyGear, mageArmorEffect } from './wizard-tier-one.js';
import {
  createRun,
  hydrateDungeonState,
  importShadowdarklingsCharacter,
  listRunsWithNames,
  listSavedCharacters,
  loadRun,
  loadSavedCharacter,
  MAX_SAVE_NAME_LENGTH,
  normalizeSaveName,
  createSavedCharacter,
  updateRun
} from "./persistence.js";
import { serializeDungeonState } from "./persistence.js";
import { getAccountSession } from "./api.js";
import {
  abilityScoreModifier,
  decrementCharacterDyingRounds,
  extractShadowdarkCharacters,
  getCharacterCoinBagSlots,
  getActiveCharacter,
  getCharacterActionModifier,
  getCharacterAmmo,
  getCharacterAmmoEntries,
  getCharacterAttackSummary,
  getCharacterDisplayHeader,
  getCharacterGearFreeSlots,
  hasCharacterAmmo,
  getCharacterStatSummary,
  markCharacterSlain,
  normalizeCharacterState,
  setActiveCharacter,
  setCharacterAmmo,
  setCharacterHp
} from "./characters.js";
import { setCharacterDamageListener } from './characters.js';
import { FAITH_SPELLS, FAITH_CRITICAL_CHOICES, castFaithSpell, resolveFaithSpell, maintainFocus, advanceFaithRounds,
  faithArmorBonus, holyWeaponBonus, protectionDisadvantage, protectionName, blocksMindControl, chooseUndeadFleeStep, restoreMonsterSpellStats } from './faith-spells.js';
import { extractDamageReferences, normalizeDamageExpression, rollDamageExpression, rollUnarmedAttack, getMaximumDamage } from "./damage.js";
import { collectLightSources, isTileIlluminated } from "./light-geometry.js";
import { handItemKind, isTwoHandedWeapon, ensureEquipment, equipItem, equipArmor, ensureArmorEquipment, syncEquipmentLight, hasOccupiedOffHand, equipImportLoadout, normalizeWeaponSpacing } from "./equipment.js";
import { preloadRendererAssets, renderDungeon } from "./render.js";
import { loadSpellLibrary, normalizeSpellLookupKey } from "./spells.js";
import { canReceiveHealing, canTouchCharacter, castCureWounds, resolveCureWounds, validateCureWoundsTarget, castingBonus } from './spell-effects.js';
import { castMagicMissile, chooseMagicMissile, fireMagicMissile, dismissMagicMissiles } from './magic-missile.js';
import { castLight, resolveLight, LIGHT_TARGET_PROMPT } from './light-spell.js';
import { applyBurningHands, castBurningHands, chooseBurningHands, releaseBurningHands } from './burning-hands.js';
import { ATTACK_RANGES, OFFENSIVE_SPELLS, canTargetAtRange, withinTargetRange, hasReadyOffensiveSpell, pendingSpellAllowsCommand, planClickMovement } from './targeting.js';
import { movementStepCost, WATER_STEP_DURATION_MS } from './terrain-movement.js';
import { isFloatingDisc, FLOATING_DISC_COLOR, floatingDiscSlotsAvailable, followFloatingDiscs, advanceFloatingDiscTime } from './floating-disc.js';
import { isInvisible, isStealthed, isHiddenMonster, neverSurprised, activateHalflingInvisibility, revealAfterOffense,
  advanceConcealmentRounds, updateMonsterStealth, surpriseParticipants } from './concealment.js';
import { castInvisibility, resolveInvisibility } from './invisibility.js';
import { TIER_TWO_SPELLS, TIER_TWO_CHOICES, castTierTwoSpell, resolveTierTwoSpell, tierTwoPresentation } from './tier-two-spells.js';
import { createTierTwoUi } from './tier-two-ui.js';
import { beginLuckEvent, captureLuckChange, finishLuckEvent, checkLuckEvent, consumeLuck, grantLuckToken, isLuckResolution } from './luck.js';
import { isTierTwoFocus, maintainTierTwoFocus, cleanupWizardTierTwoFocus, resolveDetectThoughtsResistance, detectThoughtsModifiers } from './wizard-tier-two-focus.js';
import { syncTransformationEffects, advanceTransformationRounds, maintainLevitationFocus, transformationAttackOptions, transformationAttackDisadvantage, transformationMovementRules, interceptMirrorImageHit, hasAlterSelfFeature, validateMistyStepDestination, spendClawAttack, remainingClawAttacks } from './transformation-spells.js';
import { syncAreaSpellConditions, advanceAreaSpells, areaSpellPlacement, silenceBlocksAction, silenceStealthSuccess, noiseIsSilenced, isRestrainedByWeb, escapeWeb, igniteWebsAt } from './area-spells.js';
import { initializeDisguises, concealedMimic, isDoppelganger, displayMonsterName, buildMonsterCompanion,
  recordCompanionDamage, companionLeaves, archiveSlainCharacter, dropCompanionGear, concealedAnimatedArmor,
  updateAnimatedArmorDisguises, shouldAnimatedArmorWait, animatedArmorCanEnter, planWanderingArmorRetreat, nativeGear } from './companions.js';
import { initializeMorale, processMorale, automaticallyHostile, reactionSpeaker, resolveReaction, suspiciousProvoked, monsterScore, isAnimalMonster, creatureLanguages } from './encounters.js';
import { advanceWizardTime, hasWizardEffect, isLightSuppressedAt, processWizardTurn, spellLockRemaining, SPELL_ROUND_MS, wizardCastingMode, rollWizardMishaps } from './wizard-mishaps.js';
import { isRaving, availableHands, blocksSpellTier, forgottenSpells, attackDamageMultiplier } from './arcane-effects.js';
import { applyHigherMishap, queueForcedSpell, ordBalanceOptions, resolveOrdBalance, checkSinkholeFall } from './higher-mishaps.js';
import { climbFromPit, safePitRim, ropeRescues, rescueWithRope, pushTargets, pushIntoPit, avoidsFalling, knownPitAt, pitAtBottom, ropeDescents, descendWithRope, resolvePitSave } from './pits.js';
import { resolveLuckSave, captureRuntimeLuckActor } from './luck-runtime.js';
import { makePitTunnel } from './pit-tunnels.js';
import { routeOf, routeAt, routeStep, sameRoute, makeUnderpass, routeKey } from './underpasses.js';
import { beginPartyRest, acceptPartyRest, advancePartyRest, cancelPartyRest, interruptPartyRest, restInProgress, restSupplyStatus, restingParty, restWatchSchedule, restWatchCharacters } from './rest.js';
import {
  roomRequest,
  listJoinedRooms,
  createHostSession,
  getHostSession,
  joinHostSession,
  normalizeSessionCode
} from "./multiplayer.js";
import {
  advanceTorchTime,
  forceTorchOut,
  ensureTimers,
  hasLiveTimedLight,
  lightNewTorch,
  syncElapsedTime,
  TORCH_SEARCH_ADVANCE_MS
} from "./timers.js";
import { hasLineOfSightFrom, isTileVisible, recomputeVisibility } from "./visibility.js";
import { characterMovementBudget, characterOccupant, combatStepBlock, attackNarrative, attackRollSegments, mixTokenColor, colorChannels } from './combat-rules.js';
import { planMarchingSteps } from './marching-order.js';
import { reorderGear } from './gear-order.js';
import { isSleeping, isProne, isIncorporeal, canPhase, phaseStepAllowed, wakeCreature, standCreature, conditionAttackMode } from './conditions.js';
import { portalHeld, forceHeldDoor, advancePortalRounds } from './control-spells.js';
import { findPursuitStep, planFiringPosition, planDarkReposition } from './pursuit.js';
import { isMonsterCurrentlyVisible, isFeatureCurrentlyVisible } from './monster-perception.js';
import { resetBurningLights, releaseUnequippedTorches } from './light-lifecycle.js';
import { stealableGear, selectStealTarget, takeStolenItem } from './thievery.js';
import { rollTextSegments, damageRollSegments } from './roll-history.js';
import { restTourFrame } from './rest-scene.js';
import { unawareReason, backstabMultiplier } from './backstab.js';
import { createTalentMagicItem } from './talent-magic.js';
import { elementalDamage } from './elemental-effects.js';
import { isDarkvisionCharacter, companionEquipmentClass } from './darkvision.js';
import { markMonsterCorrectlyGuessed, shouldRepositionAfterDarkGuess } from './monster-perception.js';
import { awardExperience, canLevelUp, beginLevelUp, xpTarget, advancementOptions, resolveAdvancement, classAttackBonus, masteryTargets, classArmorBonus,
  initializeImportChoices, advancementButtonLabel, STAT_NAMES, GRIT_DESCRIPTIONS, hasGrit } from './class-progression.js';
import {
  DEFAULT_WANDERING_DENOMINATOR,
  DEFAULT_WANDERING_NUMERATOR,
  maybeSpawnWanderingMonster,
  normalizeWanderingChance,
  wanderingEnabled
} from "./wandering.js";

const SERVER_RUNTIME = globalThis.__SD_SERVER_RUNTIME__ === true;
let serverMonsterTurns = null;
let serverFollowerFrames = new Map();
let missileDisplay = null;
let targetingMode = null;
let shiftAttackHeld = false;
let tierTwoUi = null;
let areaPreview = null;
let spellLuckContext = null;
const seenSpellDialogs = new Set();
let monsterTurnRadius = null;
let sharedMonsterPresentation = null;
let sharedMonsterPresentationRunning = false;
const sharedMonsterPresentationQueue = [];
const seenMonsterTurnEvents = new Set();
let dismissedTurnRadius = '';
let modalStudyResultKey = null;
let modalRestResultKey = null;
let lastPendingOffensiveSpell = null;
let clickMoveGeneration = 0;
let partyReorderDrag = null;
let activeItemCast = null;
const ui = {
  mapHost: document.getElementById("map-host"),
  levelInput: document.getElementById("level-input"),
  seedInput: document.getElementById("seed-input"),
  generateBtn: document.getElementById("generate-btn"),
  zoomInBtn: document.getElementById("zoom-in-btn"),
  zoomOutBtn: document.getElementById("zoom-out-btn"),
  saveBtn: document.getElementById("save-btn"),
  loadBtn: document.getElementById("load-btn"),
  loadCharacterBtn: document.getElementById("load-character-btn"),
  multiplayerBtn: document.getElementById("multiplayer-btn"),
  howToPlayBtn: document.getElementById("how-to-play-btn"),
  howToPlayContent: document.getElementById("how-to-play-content"),
  howToPlayLevel: document.getElementById("how-to-play-level"),
  howToPlayLevelRepeat: document.getElementById("how-to-play-level-repeat"),
  multiplayerTitle: document.getElementById("multiplayer-title"),
  multiplayerHostSection: document.getElementById("multiplayer-host-section"),
  multiplayerJoinSection: document.getElementById("multiplayer-join-section"),
  lightTorchBtn: document.getElementById("light-torch-btn"),
  lightLanternBtn: document.getElementById("light-lantern-btn"),
  castLightBtn: document.getElementById("cast-light-btn"),
  torchOutBtn: document.getElementById("torch-out-btn"),
  partyAssetsSummary: document.getElementById("party-assets-summary"),
  searchBtn: document.getElementById("search-btn"),
  stealthBtn: document.getElementById("stealth-btn"),
  searchModifierInput: document.getElementById("search-modifier-input"),
  combatPanel: document.getElementById("combat-panel"),
  combatActions: document.getElementById("combat-actions"),
  endTurnBtn: document.getElementById("end-turn-btn"),
  blackoutToggle: document.getElementById("blackout-toggle"),
  statusText: document.getElementById("status-text"),
  lockedDoorActions: document.getElementById("locked-door-actions"),
  pickLockBtn: document.getElementById("pick-lock-btn"),
  breakDoorBtn: document.getElementById("break-door-btn"),
  darknessMessage: document.getElementById("darkness-message"),
  connectivityText: document.getElementById("connectivity-text"),
  wanderingSection: document.getElementById("wandering-section"),
  wanderingNumerator: document.getElementById("wandering-numerator"),
  wanderingDenominator: document.getElementById("wandering-denominator"),
  lootList: document.getElementById("loot-list"),
  inventorySlots: document.getElementById("inventory-slots"),
  totalValue: document.getElementById("total-value"),
  roomLootPanel: document.getElementById("room-loot-panel"),
  monsterPanel: document.getElementById("monster-panel"),
  trapPanel: document.getElementById("trap-panel"),
  dungeonTabBtn: document.getElementById("dungeon-tab-btn"),
  charactersTabBtn: document.getElementById("characters-tab-btn"),
  dungeonTabPanel: document.getElementById("dungeon-tab-panel"),
  charactersTabPanel: document.getElementById("characters-tab-panel"),
  importCharacterBtn: document.getElementById("import-character-btn"),
  baseClassesOnlyToggle: document.getElementById("base-classes-only-toggle"),
  charactersEmpty: document.getElementById("characters-empty"),
  charactersList: document.getElementById("characters-list"),
  characterDetail: document.getElementById("character-detail"),
  damageResult: document.getElementById("damage-result"),
  damageContext: document.getElementById("damage-context"),
  damageExpandBtn: document.getElementById("damage-expand-btn"),
  damageDetail: document.getElementById("damage-detail"),
  diceHistoryToggle: document.getElementById("dice-history-toggle"),
  diceHistory: document.getElementById("dice-history"),
  manualDiceControls: document.getElementById("manual-dice-controls"),
  combatBannerLayer: document.getElementById("combat-banner-layer"),
  manualDieCount: document.getElementById("manual-die-count"),
  manualDieModifier: document.getElementById("manual-die-modifier"),
  manualDieReset: document.getElementById("manual-die-reset"),
  characterSheetModal: document.getElementById("character-sheet-modal"),
  characterSheetContent: document.getElementById("character-sheet-content"),
  characterSheetClose: document.getElementById("character-sheet-close"),
  spellcastingModal: document.getElementById('spellcasting-modal'),
  spellcastingList: document.getElementById('spellcasting-list'),
  spellDetailModal: document.getElementById("spell-detail-modal"),
  spellDetailClose: document.getElementById("spell-detail-close"),
  spellDetailTitle: document.getElementById("spell-detail-title"),
  spellDetailMeta: document.getElementById("spell-detail-meta"),
  spellDetailDuration: document.getElementById("spell-detail-duration"),
  spellDetailRange: document.getElementById("spell-detail-range"),
  spellDetailBody: document.getElementById("spell-detail-body"),
  saveLoadModal: document.getElementById("save-load-modal"),
  saveLoadTitle: document.getElementById("save-load-title"),
  saveLoadStatus: document.getElementById("save-load-status"),
  saveNameRow: document.getElementById("save-name-row"),
  saveNameInput: document.getElementById("save-name-input"),
  savedRunsList: document.getElementById("saved-runs-list"),
  overwriteConfirmation: document.getElementById("overwrite-confirmation"),
  overwriteConfirmBtn: document.getElementById("overwrite-confirm-btn"),
  overwriteCancelBtn: document.getElementById("overwrite-cancel-btn"),
  replaceConfirmation: document.getElementById("replace-confirmation"),
  replaceConfirmBtn: document.getElementById("replace-confirm-btn"),
  replaceCancelBtn: document.getElementById("replace-cancel-btn"),
  saveModalSubmit: document.getElementById("save-modal-submit"),
  saveLoadClose: document.getElementById("save-load-close"),
  multiplayerModal: document.getElementById("multiplayer-modal"),
  multiplayerStatus: document.getElementById("multiplayer-status"),
  multiplayerCreateHostBtn: document.getElementById("multiplayer-create-host-btn"),
  multiplayerInviteRow: document.getElementById("multiplayer-invite-row"),
  multiplayerInviteLink: document.getElementById("multiplayer-invite-link"),
  multiplayerCopyLinkBtn: document.getElementById("multiplayer-copy-link-btn"),
  multiplayerJoinCode: document.getElementById("multiplayer-join-code"),
  multiplayerJoinBtn: document.getElementById("multiplayer-join-btn"),
  multiplayerPresenceList: document.getElementById("multiplayer-presence-list"),
  multiplayerPlayerSelect: document.getElementById("multiplayer-player-select"),
  multiplayerCharacterSelect: document.getElementById("multiplayer-character-select"),
  multiplayerAssignBtn: document.getElementById("multiplayer-assign-btn"),
  multiplayerRefreshBtn: document.getElementById("multiplayer-refresh-btn"),
  multiplayerClose: document.getElementById("multiplayer-close"),
  lootCompleteModal: document.getElementById("loot-complete-modal"),
  lootCompleteClose: document.getElementById("loot-complete-close"),
  extinguishOldModal: document.getElementById("extinguish-old-modal"),
  extinguishOldYesBtn: document.getElementById("extinguish-old-yes-btn"),
  extinguishOldNoBtn: document.getElementById("extinguish-old-no-btn")
};

let state = null;
let layers = null;
let forceBlackoutWhenTorchOut = true;
let monsterTable = [];
let trapTable = [];
let shadowdarkContent = null;
let rulesData = null;
let organicAssetNames = [];
let innerWallAssetNames = [];
let bossMonsterTable = [];
let spellLibraryPromise = null;
let spellLookup = new Map();
let lastDamageRoll = null;
let diceHistory = [];
let activeTab = "dungeon";
let characterSheetPosition = null;
let characterSheetDrag = null;
let activeShopPanel = null;
let activeShopCleanup = null;
let activeShopRefresh = null;
let activeSellPanel = null;
let saveDialog = {
  mode: "save",
  runs: [],
  pendingRun: null
};
let multiplayerSession = {
  inviteCode: "",
  inviteUrl: "",
  role: "",
  currentPlayerId: null,
  players: [],
  assignments: [],
  stateJson: null
};
let multiplayerRefreshTimer = null;
let multiplayerHeartbeatTimer = null;
let multiplayerRefreshInFlight = false;
let lastRestHeartbeatAt = 0;
let multiplayerAutoJoinAttempted = false;
let accountSession = { authenticated: false };
let saveMenus = null;

function getSaveMenus() {
  if (SERVER_RUNTIME) return null;
  return saveMenus ||= createSaveMenus({
    getState: () => state,
    getSession: () => isSharedRoom() ? { ...accountSession, ...multiplayerSession } : accountSession,
    isSharedRoom, roomRequest, applyRoomState: applyMultiplayerSessionState,
    loadCharacter: record => loadSelectedCharacter(record, { keepOpen: true, throwOnError: true }),
    onPartyLoaded: loadPartySnapshot,
    onPartyNameChanged: name => { if (name) { state.partyName = name; markRunDirty(); updatePanels(); } },
    onStatus: setStatus
  });
}

function loadPartySnapshot(snapshot) {
  if (isSharedRoom() || isCombatActive() || restInProgress(state)) throw new Error('Finish combat/rest and leave multiplayer before replacing the party.');
  const members = structuredClone(snapshot.characters || []);
  if (!members.length || members.length > 16) throw new Error('A party must contain 1 to 16 members.');
  const positions = dungeonArrivalPositions(state, members.length);
  if (positions.length !== members.length) throw new Error('Generate a dungeon with enough safe starting-room space for this party.');
  const identities = new Map(members.map(member => [member.id, `character-${crypto.randomUUID()}`]));
  const remap = (value, field = '') => {
    if (Array.isArray(value)) return value.map(child => remap(child, field));
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, key === 'lineageId' ? child : remap(child, key)]));
    return typeof value === 'string' && /(?:^id$|Ids?$|_ids?$)/.test(field) && identities.has(value) ? identities.get(value) : value;
  };
  members.forEach((member, index) => {
    const lineageId = member.lineageId || member.id;
    Object.assign(member, remap(member), { lineageId });
    member.raw ||= {}; Object.assign(member.raw, { id: member.id, lineageId });
    delete member.owner_member_id; delete member.raw.owner_member_id;
    if (member.companion) {
      const sourceId = `party-companion-${crypto.randomUUID()}`;
      member.companion.sourceMonsterId = sourceId;
      if (member.companion.source) member.companion.source.id = sourceId;
      member.raw.companion = structuredClone(member.companion);
    }
    Object.assign(member, positions[index]);
    delete member.pendingSpell; delete member.pendingSteal; delete member.pendingFall;
    if (member.conditions) { delete member.conditions.sinkhole; delete member.conditions.pitLedge; }
    if (isFloatingDisc(member)) member.summon.trail = [];
  });
  const previous = state;
  const candidate = hydrateDungeonState(serializeDungeonState(previous));
  candidate.characters = members;
  for (const key of ['partyName', 'partyAssets', 'timers', 'arcaneTime', 'spellClock', 'roundClock', 'gameClock']) {
    if (snapshot[key] !== undefined) candidate[key] = structuredClone(snapshot[key]);
  }
  ensureTimers(candidate).lastTickAt = Date.now();
  candidate.activeCharacterId = identities.get(snapshot.activeCharacterId) || members[0].id;
  normalizeCharacterState(candidate);
  try {
    state = candidate;
    syncAllCharacterEquipmentDerivedStats(); ensureCharacterPresentation(); syncPlayerToActiveCharacter(); recomputeVisibility(state);
  } catch (error) { state = previous; throw error; }
  markRunDirty(); updatePanels(); render();
}

async function descendDungeon() {
  const level = Number(state.level) + 1;
  const [content, rules, organic, inner, traps, monsters, bosses, library] = await Promise.all([
    loadShadowdarkContent(), loadRulesData(), loadOrganicAssets(), loadInnerWallAssets(), loadTrapTable(),
    loadMonsterTableForLevel(level), loadBossMonsterTableForLevel(level), ensureSpellLibraryLoaded()
  ]);
  state = buildNextLevelState(state, { seed: createRandomDungeonSeed(), generationOptions: {
    monsterTable: monsters, bossMonsterTable: bosses, trapTable: traps, contentCatalog: content, rulesData: rules,
    spells: library.spells, organicAssets: organic, innerWallAssets: inner
  } });
  shadowdarkContent = content; rulesData = rules; monsterTable = monsters; bossMonsterTable = bosses; trapTable = traps;
  normalizeCharacterState(state); ensureCombatState(); syncAllCharacterEquipmentDerivedStats(); syncPlayerToActiveCharacter();
  recomputeVisibility(state); markRunDirty();
  if (!SERVER_RUNTIME) { ui.levelInput.value = state.level; ui.seedInput.value = state.seed; setupCanvasLayers(state); updatePanels(); render(); }
  setStatus(`Descended to dungeon level ${state.level}.`);
}

async function requestDungeonDescent() {
  const status = dungeonDescentStatus(state);
  if (!status.ok) { setStatus(status.message); return; }
  if (isSharedRoom()) {
    try { applyMultiplayerSessionState(await roomRequest(multiplayerSession.id, 'group-action', { action: 'descend' })); }
    catch (error) { setStatus(error.message); }
    return;
  }
  const modal = document.createElement('dialog'); modal.className = 'sd-save-menus sd-simple-dialog'; modal.setAttribute('aria-label', 'Descend');
  modal.addEventListener('keydown', event => event.stopPropagation());
  const text = document.createElement('p'); text.textContent = status.message;
  const yes = document.createElement('button'); yes.textContent = 'Yes';
  const no = document.createElement('button'); no.textContent = 'No';
  no.onclick = () => { modal.close(); modal.remove(); };
  yes.onclick = async () => { yes.disabled = true; try { await descendDungeon(); modal.close(); modal.remove(); } catch (error) { setStatus(error.message); yes.disabled = false; } };
  modal.addEventListener('close', () => modal.remove()); modal.append(text, yes, no); document.body.append(modal); modal.showModal();
}
let pendingLightRequest = null;
let lastDyingAutoTickAt = Date.now();
let autoEndTurnTimer = null;
let combatBannerPromise = Promise.resolve();
let activeCombatBanner = null;

const BASE_CLASSES_ONLY_STORAGE_KEY = "shadowspawner.baseClassesOnly";
const SHADOWDARKLINGS_SOURCE_SWITCHES = [
  "Scroll #1",
  "Scroll #2",
  "Scroll #3",
  "Scroll #4",
  "B&R&K",
  "Roustabout",
  "Unnatural Selection",
  "Darcy"
];
let viewport = {
  scale: 1,
  minScale: 1,
  maxScale: 2.4,
  width: 0,
  height: 0,
  panX: 0,
  panY: 0
};
const DRAG_THRESHOLD_PX = 8;
const CHARACTER_COMBAT_MOVE = 6;
const RANGE_LIMITS = ATTACK_RANGES;
const ATTITUDE_TAG_MODIFIERS = Object.freeze({
  humanoid: 0,
  orc: 3,
  tough: 3,
  goblin: 2,
  goblinoid: 2,
  thieves: 2,
  thief: 2,
  animal: 0,
  ooze: 10,
  undead: 8,
  horror: 8,
  celestial: -5,
  demon: 10,
  devil: 5,
  fiend: 5,
  fey: -1,
  dragon: 5,
  plant: -5
});
const characterAmmoOverrides = new Map();
const characterColorOverrides = new Map();
const CHARACTER_COLOR_PALETTE = Object.freeze([
  { id: "violet", label: "Violet", value: "rgb(127, 0, 127)" },
  { id: "blue", label: "Blue", value: "rgb(0, 0, 217)" },
  { id: "green", label: "Green", value: "rgb(0, 212, 0)" },
  { id: "gold", label: "Gold", value: "rgb(199, 176, 0)" },
  { id: "amber", label: "Amber", value: "rgb(179, 112, 0)" },
  { id: "red", label: "Red", value: "rgb(127, 0, 0)" },
  { id: "plum-dark", label: "Plum dark", value: "rgb(55, 27, 99)" },
  { id: "blue-dark", label: "Blue dark", value: "rgb(0, 47, 105)" },
  { id: "green-dark", label: "Green dark", value: "rgb(33, 82, 10)" },
  { id: "khaki-dark", label: "Khaki dark", value: "rgb(99, 96, 8)" },
  { id: "brown-dark", label: "Brown dark", value: "rgb(74, 52, 16)" },
  { id: "rose-dark", label: "Rose dark", value: "rgb(71, 6, 49)" },
  { id: "light-violet", label: "Light violet", value: "rgb(255, 0, 255)" },
  { id: "cyan-bright", label: "Cyan bright", value: "rgb(0, 255, 255)" },
  { id: "teal-mid", label: "Teal mid", value: "rgb(149, 176, 53)" },
  { id: "light-khaki", label: "Light khaki", value: "rgb(184, 184, 129)" },
  { id: "light-gold", label: "Light gold", value: "rgb(255, 210, 112)" },
  { id: "light-rose", label: "Light rose", value: "rgb(224, 155, 194)" }
  ,{ id: "black", label: "Black", value: "rgb(0, 0, 0)" }
  ,{ id: "silver", label: "Silver", value: "rgb(191, 191, 191)" }
  ,{ id: "gray", label: "Gray", value: "rgb(90, 97, 64)" }
  ,{ id: "lime-muted", label: "Lime muted", value: "rgb(127, 127, 127)" }
  ,{ id: "slate", label: "Slate", value: "rgb(135, 122, 96)" }
  ,{ id: "stone", label: "Stone", value: "rgb(176, 165, 160)" }
]);
/** Slightly smaller than "fit entire map" so neither axis binds flush; otherwise the limiting axis often gets zero slack (only X or only Y would pan). */
const MIN_ZOOM_INSET = 0.92;
let dragState = null;
let mapHoverPointer = null;
let attackCursorImage = null;
const attackCursorCache = new Map();

async function loadShadowdarkContent() {
  try {
    return await loadLocalJson("./data/shadowdark-content.json");
  } catch (error) {
    console.warn("Using fallback local content because the Shadowdark snapshot could not load.", error);
    return { monsters: [], loot: { gear: [], armor: [], weapons: [], magicItems: [] } };
  }
}

async function loadTrapTable() {
  try {
    return await loadLocalJson("./traps.json");
  } catch (error) {
    console.warn("Using fallback trap names because traps.json could not load.", error);
    return [];
  }
}

function getMonsterBucket(level) {
  const parsed = Number(level) || 1;
  return Math.max(1, Math.min(10, parsed >= 10 ? 10 : parsed));
}

async function loadMonsterTableForLevel(level) {
  const bucket = getMonsterBucket(level);
  return loadMonsterTableForBucket(bucket);
}

async function loadMonsterTableForBucket(bucket) {
  const normalizedBucket = Math.max(1, Math.min(10, Number(bucket) || 1));
  try {
    const payload = await loadLocalJson(`./monsters-${normalizedBucket}.json`);
    return Array.isArray(payload) ? payload : [];
  } catch (error) {
    console.warn(`Using fallback monster table for level ${normalizedBucket}.`, error);
    return Array.isArray(shadowdarkContent?.monsters)
      ? shadowdarkContent.monsters.filter((monster) => {
        const monsterLevel = Number(monster?.level ?? monster?.lv ?? monster?.["**LV**"] ?? 1) || 1;
        return normalizedBucket >= 10 ? monsterLevel >= 10 : monsterLevel === normalizedBucket;
      })
      : [];
  }
}

async function loadBossMonsterTableForLevel(level) {
  const parsedLevel = Math.max(1, Number(level) || 1);
  const buckets = new Set([
    getMonsterBucket(parsedLevel + 1),
    getMonsterBucket(parsedLevel + 2),
    getMonsterBucket(parsedLevel + 3)
  ]);
  const tables = await Promise.all([...buckets].map((bucket) => loadMonsterTableForBucket(bucket)));
  const seen = new Set();
  return tables.flat().filter((monster) => {
    const key = `${monster?.name || monster?.["Monster Name"] || ""}:${monster?.level ?? monster?.lv ?? ""}`;
    if (!key.trim() || seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

async function loadOrganicAssets() {
  try {
    const payload = await loadLocalJson("./data/organic-assets.json");
    return Array.isArray(payload) ? payload : [];
  } catch (error) {
    console.warn("Organic dungeon assets could not load; skipping organic room shaping.", error);
    return [];
  }
}

async function loadInnerWallAssets() {
  try {
    const payload = await loadLocalJson("./data/inner-wall-assets.json");
    return Array.isArray(payload) ? payload : [];
  } catch (error) {
    console.warn("Inner-wall dungeon assets could not load; skipping inner-wall room shaping.", error);
    return [];
  }
}

async function ensureSpellLibraryLoaded() {
  if (!spellLibraryPromise) {
    spellLibraryPromise = loadSpellLibrary().then((library) => {
      spellLookup = library.lookup;
      return library;
    });
  }
  return spellLibraryPromise;
}

function createLayerCanvas(className, width, height) {
  const canvas = document.createElement("canvas");
  canvas.className = className;
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function setupCanvasLayers(currentState) {
  ui.mapHost.innerHTML = "";
  const width = currentState.map.width * TILE_SIZE_PX;
  const height = currentState.map.height * TILE_SIZE_PX;
  ui.mapHost.style.width = `${width}px`;
  ui.mapHost.style.height = `${height}px`;
  viewport.width = width;
  viewport.height = height;
  viewport.panX = 0;
  viewport.panY = 0;

  const background = createLayerCanvas("layer layer-background", width, height);
  const topology = createLayerCanvas("layer layer-topology", width, height);
  const objects = createLayerCanvas("layer layer-objects", width, height);
  const fog = createLayerCanvas("layer layer-fog", width, height);

  ui.mapHost.append(background, topology, objects, fog);

  layers = {
    backgroundCtx: background.getContext("2d"),
    topologyCtx: topology.getContext("2d"),
    objectsCtx: objects.getContext("2d"),
    fogCtx: fog.getContext("2d"),
    objectsCanvas: objects
  };
  updateViewportBounds();
  applyViewportScale(1);
}

function getMapViewSize(panel) {
  const style = getComputedStyle(panel);
  const pl = parseFloat(style.paddingLeft) || 0;
  const pr = parseFloat(style.paddingRight) || 0;
  const pt = parseFloat(style.paddingTop) || 0;
  const pb = parseFloat(style.paddingBottom) || 0;
  return {
    width: Math.max(1, panel.clientWidth - pl - pr),
    height: Math.max(1, panel.clientHeight - pt - pb)
  };
}

function pointerInMapView(panel, clientX, clientY) {
  const rect = panel.getBoundingClientRect();
  const style = getComputedStyle(panel);
  const pl = parseFloat(style.paddingLeft) || 0;
  const pt = parseFloat(style.paddingTop) || 0;
  return {
    x: clientX - rect.left - pl,
    y: clientY - rect.top - pt
  };
}

function getMapViewCenter(panel) {
  const { width, height } = getMapViewSize(panel);
  return {
    x: width / 2,
    y: height / 2
  };
}

function updateViewportBounds() {
  const panel = ui.mapHost.parentElement;
  const { width: availableWidth, height: availableHeight } = getMapViewSize(panel);
  const fit = Math.min(1, availableWidth / viewport.width, availableHeight / viewport.height);
  viewport.minScale = fit * MIN_ZOOM_INSET;
  viewport.scale = Math.max(viewport.minScale, Math.min(viewport.maxScale, viewport.scale));
}

function centerMapInView() {
  const panel = ui.mapHost.parentElement;
  const { width: viewW, height: viewH } = getMapViewSize(panel);
  const mw = viewport.width * viewport.scale;
  const mh = viewport.height * viewport.scale;
  const focus = getActiveCharacter(state) || state.player;
  viewport.panX = mw > viewW ? viewW / 2 - (Number(focus?.x || 0) + .5) * TILE_SIZE_PX * viewport.scale : (viewW - mw) / 2;
  viewport.panY = mh > viewH ? viewH / 2 - (Number(focus?.y || 0) + .5) * TILE_SIZE_PX * viewport.scale : (viewH - mh) / 2;
}

function clampPan() {
  const panel = ui.mapHost.parentElement;
  const { width: viewW, height: viewH } = getMapViewSize(panel);
  const mw = viewport.width * viewport.scale;
  const mh = viewport.height * viewport.scale;

  if (mw > viewW) {
    viewport.panX = Math.max(viewW - mw, Math.min(0, viewport.panX));
  } else {
    const maxSlackX = viewW - mw;
    viewport.panX = Math.max(0, Math.min(maxSlackX, viewport.panX));
  }
  if (mh > viewH) {
    viewport.panY = Math.max(viewH - mh, Math.min(0, viewport.panY));
  } else {
    const maxSlackY = viewH - mh;
    viewport.panY = Math.max(0, Math.min(maxSlackY, viewport.panY));
  }
}

function commitViewportTransform() {
  clampPan();
  ui.mapHost.style.transform = `translate(${viewport.panX}px, ${viewport.panY}px) scale(${viewport.scale})`;
  updateMonsterHoverCursor();
}

function applyViewportScale(nextScale, anchor = null) {
  updateViewportBounds();
  const previousScale = viewport.scale;
  const scale = Math.max(viewport.minScale, Math.min(viewport.maxScale, nextScale));

  if (anchor) {
    const localX = (anchor.x - viewport.panX) / previousScale;
    const localY = (anchor.y - viewport.panY) / previousScale;
    viewport.scale = scale;
    viewport.panX = anchor.x - localX * scale;
    viewport.panY = anchor.y - localY * scale;
  } else {
    viewport.scale = scale;
    centerMapInView();
  }

  ui.mapHost.style.width = `${viewport.width}px`;
  ui.mapHost.style.height = `${viewport.height}px`;
  ui.mapHost.style.marginRight = "";
  ui.mapHost.style.marginBottom = "";
  commitViewportTransform();
}

function zoomMapBy(multiplier) {
  if (!state) {
    return;
  }
  const panel = ui.mapHost.parentElement;
  applyViewportScale(viewport.scale * multiplier, getMapViewCenter(panel));
}

function setStatus(resultOrMessage) {
  const result = typeof resultOrMessage === "string"
    ? { message: resultOrMessage }
    : resultOrMessage || { message: "" };
  ui.statusText.classList.toggle("trap-sprung-status", result.trapSprung === true);
  ui.statusText.classList.toggle("no-free-slots-status", result.noFreeSlots === true);
  const messageContext = { state, rulesData, monsters: shadowdarkContent?.monsters || monsterTable, spells: spellLookup };
  ui.statusText.textContent = formatRulesMessage(result.trapSprung
    ? `Trap is Sprung! ${result.message || ""}`
    : result.message || "", messageContext);
  ui.darknessMessage.textContent = formatRulesMessage(result.darknessMessage || "", messageContext);
  updateLockedDoorUi();
}

function delay(ms) {
  if (SERVER_RUNTIME) return Promise.resolve();
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function markUserActivity() {
  if (!state) {
    return;
  }
  state.run = {
    ...state.run,
    dirty: true,
    hasUserActivity: true
  };
}

function updateWanderingUi() {
  if (!state) {
    return;
  }
  if (ui.wanderingNumerator) {
    ui.wanderingNumerator.value = `${state.wanderingMonsters?.numerator ?? DEFAULT_WANDERING_NUMERATOR}`;
    sizeControlField(ui.wanderingNumerator);
  }
  if (ui.wanderingDenominator) {
    ui.wanderingDenominator.value = `${state.wanderingMonsters?.denominator ?? DEFAULT_WANDERING_DENOMINATOR}`;
    sizeControlField(ui.wanderingDenominator);
  }
  ui.wanderingSection?.classList.toggle("is-disabled", !wanderingEnabled(state));
}

function updateHowToPlayLevel() {
  const level = `${Math.max(1, Math.min(10, Number(ui.levelInput?.value) || 1))}`;
  if (ui.howToPlayLevel) {
    ui.howToPlayLevel.textContent = level;
  }
  if (ui.howToPlayLevelRepeat) {
    ui.howToPlayLevelRepeat.textContent = level;
  }
}

function updateLockedDoorUi() {
  const action = getPendingLockedDoorAction(state);
  ui.lockedDoorActions.hidden = !action;
  if (!action) {
    return;
  }
  ui.pickLockBtn.textContent = 'Open Lock';
  ui.pickLockBtn.title = `Pick lock: DC ${action.pickDc}`;
  ui.breakDoorBtn.textContent = 'Smash';
  ui.breakDoorBtn.title = `Smash door: DC ${action.breakDc}`;
}

function updateTrapActionUi() {
  // Revealed trap cards render their own Disarm? button; there is no global disarm control.
}

function updateCombatUi() {
  const combat = ensureCombatState();
  const active = combat.active === true;
  if (ui.combatActions) {
    const entry = getCurrentCombatEntry();
    ui.combatActions.hidden = !(active && entry?.type === "character");
    ui.combatActions.classList.toggle("is-action-used", Boolean(active && entry?.type === "character" && combat.actionUsed));
  }
  ui.endTurnBtn?.classList.toggle("is-highlighted", Boolean(active && getCurrentCombatEntry()?.type === "character" && combat.actionUsed));
  syncTurnCard();
  if (!ui.combatPanel) {
    return;
  }
  ui.combatPanel.hidden = !active;
  ui.combatPanel.innerHTML = "";
  if (!active) {
    return;
  }
  const entry = getCurrentCombatEntry();
  const currentName = entry?.type === "character"
    ? state.characters.find((character) => character.id === entry.id)?.name || "Character"
    : getMonsterById(entry?.id)?.name || "Monster";
  const summary = document.createElement("div");
  const round = document.createElement("strong");
  round.textContent = `Round ${combat.round}`;
  summary.append(round, document.createTextNode(`: ${currentName}'s turn.`));
  ui.combatPanel.append(summary);
  if (entry?.type === "character") {
    const actor = state.characters.find(character => character.id === entry.id);
    ui.combatPanel.style.setProperty('--turn-color', getCharacterColorValue(actor));
    const detail = document.createElement("div");
    detail.textContent = `Move ${combat.movementRemaining}/${combat.movementBudget ?? characterMovementBudget(actor)}. Action ${combat.actionUsed ? "used" : "ready"}.`;
    ui.combatPanel.append(detail);
  }
}

let turnCardKey = '', turnCardSignature = '';
function syncTurnCard() {
  if (SERVER_RUNTIME) return;
  const layer = document.getElementById('turn-card-layer');
  if (!layer) return;
  const entry = sharedMonsterPresentation ? { type: 'monster', id: sharedMonsterPresentation.actor.id } : isCombatActive() ? getCurrentCombatEntry() : null;
  const character = entry?.type === 'character' ? state.characters.find(member => member.id === entry.id) : null;
  const monster = entry?.type === 'monster' ? sharedMonsterPresentation?.actor || getMonsterById(entry.id) : null;
  const actor = character || monster;
  const key = actor ? `${state.combat.round}:${state.combat.turnIndex}:${actor.id}` : '';
  const columnSource = character ? [...ui.charactersList.children].find(card => card.dataset.characterId === character.id)?.getBoundingClientRect() : null;
  for (const card of ui.charactersList?.children || []) card.classList.remove('is-on-map');
  makeTurnCardDraggable(layer);
  if (columnSource?.width) layer.style.width = `${Math.min(columnSource.width * 1.15, (layer.parentElement?.clientWidth || 600) - 24)}px`;
  clampTurnCard(layer);
  layer.hidden = !actor;
  if (!actor) { layer.replaceChildren(); turnCardKey = ''; turnCardSignature = ''; return; }
  const signature = JSON.stringify([actor, state.combat.actionUsed, state.combat.movementRemaining]);
  if (key === turnCardKey && signature === turnCardSignature) return;
  const source = character ? columnSource :
    [...ui.monsterPanel.children].find(card => card.dataset.monsterId === monster.id)?.getBoundingClientRect();
  const changedTurn = key !== turnCardKey;
  turnCardKey = key; turnCardSignature = signature;
  const card = character ? renderCharacterCard(character) : renderMonsterMini(monster);
  card.classList.add('turn-character-card');
  layer.replaceChildren(card);
  if (character && ui.combatActions) layer.append(ui.combatActions);
  if (changedTurn) document.querySelectorAll('.turn-card-flight').forEach(node => node.remove());
  if (changedTurn && character && source?.width > 0 && card.animate) {
    const target = card.getBoundingClientRect();
    const ghost = card.cloneNode(true);
    ghost.classList.add('turn-card-flight');
    Object.assign(ghost.style, { position: 'fixed', left: `${source.left}px`, top: `${source.top}px`, width: `${source.width}px`,
      margin: '0', pointerEvents: 'none', zIndex: '1000', transformOrigin: '0 0' });
    document.body.append(ghost); card.style.visibility = 'hidden';
    const flight = ghost.animate([{ transform: 'translate(0,0) scale(1)' },
      { transform: `translate(${target.left - source.left}px, ${target.top - source.top}px) scale(${target.width / source.width})` }],
      { duration: matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 1000, easing: 'ease-in-out' });
    flight.finished.finally(() => { ghost.remove(); card.style.removeProperty('visibility'); });
  }
}

function makeTurnCardDraggable(layer) {
  if (layer.dataset.dragReady) return;
  layer.dataset.dragReady = 'true';
  let drag = null, suppressClick = false;
  layer.addEventListener('pointerdown', event => {
    if (event.button !== 0 || event.target.closest('button,input,select,a')) return;
    const rect = layer.getBoundingClientRect(), parent = layer.parentElement.getBoundingClientRect();
    drag = { id: event.pointerId, x: event.clientX, y: event.clientY, left: rect.left - parent.left, top: rect.top - parent.top, moved: false };
    layer.setPointerCapture(event.pointerId); event.stopPropagation();
  });
  layer.addEventListener('pointermove', event => {
    if (!drag || drag.id !== event.pointerId) return;
    if (Math.hypot(event.clientX - drag.x, event.clientY - drag.y) < 5 && !drag.moved) return;
    drag.moved = true; event.preventDefault(); event.stopPropagation();
    layer.style.transform = 'none';
    layer.style.left = `${Math.max(0, Math.min(layer.parentElement.clientWidth - layer.offsetWidth, drag.left + event.clientX - drag.x))}px`;
    layer.style.top = `${Math.max(0, Math.min(layer.parentElement.clientHeight - layer.offsetHeight, drag.top + event.clientY - drag.y))}px`;
  });
  const finish = event => { if (drag?.id !== event.pointerId) return; suppressClick = drag.moved; drag = null; };
  layer.addEventListener('pointerup', finish); layer.addEventListener('pointercancel', finish);
  layer.addEventListener('click', event => { if (suppressClick) { event.preventDefault(); event.stopImmediatePropagation(); suppressClick = false; } }, true);
}

function clampTurnCard(layer = document.getElementById('turn-card-layer')) {
  if (!layer || layer.hidden || layer.style.transform !== 'none') return;
  const parent = layer.parentElement;
  layer.style.left = `${Math.max(0, Math.min(parent.clientWidth - layer.offsetWidth, parseFloat(layer.style.left) || 0))}px`;
  layer.style.top = `${Math.max(0, Math.min(parent.clientHeight - layer.offsetHeight, parseFloat(layer.style.top) || 0))}px`;
}

function getCombatBannerLayer() {
  if (ui.combatBannerLayer) {
    return ui.combatBannerLayer;
  }
  const mapPanel = ui.mapHost?.closest?.(".map-panel");
  if (!mapPanel) {
    return null;
  }
  const layer = document.createElement("div");
  layer.id = "combat-banner-layer";
  layer.className = "combat-banner-layer";
  mapPanel.append(layer);
  ui.combatBannerLayer = layer;
  return layer;
}

async function flyOutCombatBanner() {
  if (!activeCombatBanner) {
    return;
  }
  const banner = activeCombatBanner;
  activeCombatBanner = null;
  banner.classList.remove("is-visible");
  banner.classList.add("is-exiting");
  await delay(680);
  banner.remove();
}

async function showCombatBannerNow(text, color, options = {}) {
  if (SERVER_RUNTIME) return;
  const layer = getCombatBannerLayer();
  if (!layer) {
    return;
  }
  await flyOutCombatBanner();
  const banner = document.createElement("div");
  banner.className = "combat-fly-banner";
  banner.style.setProperty("--combat-banner-color", color || "#fff");
  const left = document.createElement("span");
  left.className = "combat-fly-banner-line";
  const label = document.createElement("span");
  label.className = "combat-fly-banner-text";
  label.textContent = text;
  const right = document.createElement("span");
  right.className = "combat-fly-banner-line";
  banner.append(left, label, right);
  layer.append(banner);
  activeCombatBanner = banner;
  window.requestAnimationFrame(() => {
    banner.classList.add("is-visible");
  });
  await delay(680);
  if (options.holdMs) {
    await delay(options.holdMs);
    await flyOutCombatBanner();
  }
}

function enqueueCombatBanner(text, color, options = {}) {
  combatBannerPromise = combatBannerPromise
    .catch(() => {})
    .then(() => showCombatBannerNow(text, color, options));
  return combatBannerPromise;
}

function getCombatTurnBanner(entry = getCurrentCombatEntry()) {
  if (!entry) {
    return null;
  }
  if (entry.type === "monster") {
    const monster = getMonsterById(entry.id);
    return {
      text: `${monster?.name || "Monster"}'s Turn.`,
      color: "#d41111"
    };
  }
  const character = state.characters.find((candidate) => candidate.id === entry.id);
  return {
    text: `${character?.name || "Character"}'s Turn.`,
    color: getCharacterColorValue(character)
  };
}

function announceCombatBegins() {
  return enqueueCombatBanner("Combat Begins!", "#d41111", { holdMs: 1500 });
}

function announceCombatOver() {
  return Promise.resolve();
}

function announceCurrentTurn(entry = getCurrentCombatEntry()) {
  if (SERVER_RUNTIME) return Promise.resolve();
  updateCharactersUi(); syncTurnCard();
  if (entry?.type === 'monster') {
    const monster = getMonsterById(entry.id);
    if (monster) {
      monsterTurnRadius = { id: monster.id, until: Date.now() + 500 };
      render(); return delay(500).then(() => { monsterTurnRadius = null; render(); });
    }
  }
  render(); return Promise.resolve();
}

function sizeControlField(input) {
  if (!input?.matches("[data-autosize-field]")) {
    return;
  }
  const configuredChars = Number(input.dataset.sizeChars) || 0;
  const valueChars = String(input.value || input.placeholder || "").length;
  const maxChars = input.max ? String(input.max).length : 0;
  const minChars = input.min && input.min.startsWith("-") ? String(input.min).length : 0;
  const chars = Math.max(configuredChars, valueChars, maxChars, minChars, 1);
  input.style.setProperty("--field-width", `calc(${chars}ch + 2.6em)`);
}

function updateControlSizing() {
  document.querySelectorAll("[data-autosize-field]").forEach(sizeControlField);
}

function syncSidebarWidth() {
  // Fixed width: ~180px narrow default + 300px requested (not title-sized).
  const SIDEBAR_WIDTH_PX = 480;
  const panel = document.querySelector(".controls-panel");
  if (!panel) {
    return;
  }
  panel.style.width = window.innerWidth <= 1200 ? "100%" : `${SIDEBAR_WIDTH_PX}px`;
  panel.style.setProperty("--sidebar-width", `${SIDEBAR_WIDTH_PX}px`);
  const layout = document.querySelector(".layout");
  if (layout) {
    layout.style.setProperty("--sidebar-width", `${SIDEBAR_WIDTH_PX}px`);
  }
}

function processWanderingChecks(count) {
  let lastMessage = "";
  let combatStarted = false;
  for (let i = 0; i < count; i += 1) {
    if(state.entities.some(monster=>monster.curious?.remainingMs>0)) {
      state.curiousEncounterParity=(Number(state.curiousEncounterParity)||0)+1;
      if(state.curiousEncounterParity%2)continue;
    }
    const result = maybeSpawnWanderingMonster(state, monsterTable);
    if (result.message) {
      lastMessage = result.message;
    }
    if (result.spawned) {
      const sighting = processMonsterVisibilityChange();
      combatStarted = combatStarted || sighting?.combatStarted === true || sighting?.combatEnded === true;
    }
  }
  if (lastMessage && !combatStarted) {
    setStatus(lastMessage);
  }
}

let lightAnimationFrame = null;
let restCamera = null;
function positionRestModal(scrollToMap = false) {
  const panel = ui.mapHost.parentElement, modal = document.getElementById('rest-modal');
  if (scrollToMap && window.innerWidth < 700) panel.scrollIntoView({ block: 'start' });
  const rect = panel.getBoundingClientRect(), left = Math.max(0, rect.left), top = Math.max(0, rect.top);
  const width = Math.max(1, Math.min(window.innerWidth, rect.right) - left);
  const height = Math.max(1, Math.min(window.innerHeight, rect.bottom) - top);
  Object.assign(modal.style, { left: `${left}px`, top: `${top}px`, width: `${width}px`, height: `${height}px`, right: 'auto', bottom: 'auto' });
  modal.querySelector('.modal-card').style.maxHeight = `${Math.max(100, height - 24)}px`;
  return { width, height };
}
function updateRestCamera(scene, frame, visible) {
  if (!visible) {
    if (restCamera) { Object.assign(viewport, restCamera.previous); restCamera = null; commitViewportTransform(); }
    return;
  }
  const panel = ui.mapHost.parentElement;
  const modal = document.getElementById('rest-modal');
  const first = restCamera?.scene !== scene.startedAt;
  const visibleSize = positionRestModal(first);
  if (first) restCamera = { scene: scene.startedAt, previous: { scale: viewport.scale, panX: viewport.panX, panY: viewport.panY }, last: performance.now() };
  const card = modal.hidden ? null : modal.querySelector('.modal-card');
  const narrow = visibleSize.width < 600;
  const availableWidth = Math.max(100, visibleSize.width - (card && !narrow ? card.offsetWidth + 24 : 0));
  const focus = frame.active && frame.position ? frame.position : scene;
  viewport.scale = viewport.maxScale;
  const x = availableWidth / 2 - (focus.x + .5) * TILE_SIZE_PX * viewport.scale;
  const topInset = card && narrow ? card.offsetHeight + 24 : 0;
  const y = topInset + Math.max(60, visibleSize.height - topInset) / 2 - (focus.y + .5) * TILE_SIZE_PX * viewport.scale;
  const now = performance.now(), blend = !first && frame.active ? Math.min(1, (now - restCamera.last) / 100) : 1;
  viewport.panX += (x - viewport.panX) * blend;
  viewport.panY += (y - viewport.panY) * blend;
  restCamera.last = now;
  commitViewportTransform();
}
function render(options = {}) {
  if (SERVER_RUNTIME) return;
  const now = Date.now(), scene = state.rest?.scene, frame = restTourFrame(scene, now);
  const restVisible = Boolean(scene && state.rest.suppliesPaid && (['sleeping', 'voting'].includes(state.rest.phase) ||
    !document.getElementById('rest-modal').hidden && state.rest.phase === 'completed'));
  updateRestCamera(scene, frame, restVisible);
  const caster = restVisible && frame.active ? state.characters.find(member => member.id === scene.casterId) : null;
  const visual = caster ? [caster.visualX, caster.visualY] : null;
  if (caster && frame.position) { caster.visualX = frame.position.x; caster.visualY = frame.position.y; }
  state.lightVisualTime = now;
  renderDungeon(state, layers, {
    forceBlackout: state.lightTransition && Date.now() - state.lightTransition.startedAt < 1000 || forceBlackoutWhenTorchOut && !hasAnyVisibleLightSource() && getActiveCharacter(state)?.companion?.kind!=='doppelganger',
    motionOnly: options.motionOnly === true,
    lightPolygons: options.lightPolygons,
    targeting: currentTargetingOverlay(), areaPreview, restNow: now, restSceneVisible: restVisible
  });
  if (caster) { [caster.visualX, caster.visualY] = visual; }
  delete state.lightVisualTime;
  if ((restVisible && frame.active || state.lightTransition && now < state.lightTransition.startedAt + 3000 || state.areaSpells?.some(zone => zone.burnedAt && now < zone.burnedAt + 1500)) && !lightAnimationFrame) {
    lightAnimationFrame = requestAnimationFrame(() => { lightAnimationFrame = null; render({ motionOnly: true }); });
  }
  updateMonsterHoverCursor();
  if (options.motionOnly === true) return;
  if (ui.connectivityText) {
    ui.connectivityText.textContent = state.generation.connectivityValid ? "valid" : "invalid";
  }
  updateLightControlUi();
  updateLockedDoorUi();
  updateTrapActionUi();
  updateCombatUi();
  updateWanderingUi();
}

function setActiveTab(nextTab) {
  activeTab = nextTab;
  const isDungeon = nextTab === "dungeon";
  ui.dungeonTabBtn?.classList.toggle("is-active", isDungeon);
  ui.charactersTabBtn?.classList.toggle("is-active", !isDungeon);
  ui.dungeonTabBtn?.setAttribute("aria-selected", `${isDungeon}`);
  ui.charactersTabBtn?.setAttribute("aria-selected", `${!isDungeon}`);
  if (ui.dungeonTabPanel) {
    ui.dungeonTabPanel.hidden = false;
  }
  if (ui.charactersTabPanel) {
    ui.charactersTabPanel.hidden = true;
  }
  if (ui.characterDetail) {
    ui.characterDetail.hidden = true;
  }
  if (!isDungeon && state) {
    updateCharactersUi();
  }
}

function updateLootUi() {
  if (!ui.lootList || !ui.totalValue || !ui.inventorySlots) {
    return;
  }
  ui.lootList.innerHTML = "";
  for (const entry of state.lootLog.entries) {
    const item = document.createElement("li");
    item.className = "loot-item";
    const slotText = `${entry.slots || 1} slot${(entry.slots || 1) === 1 ? "" : "s"}`;
    const valueText = entry.priceless ? "priceless" : formatTreasureValue(entry.value);
    item.textContent = `${entry.name} (${slotText}, ${valueText})`;
    const dropBtn = document.createElement("button");
    dropBtn.textContent = "Leave";
    dropBtn.addEventListener("click", () => {
      const result = dropLootAtPlayer(state, entry.id);
      markUserActivity();
      setStatus(result);
      render();
      updatePanels();
    });
    item.append(" ", dropBtn);
    ui.lootList.append(item);
  }
  ui.totalValue.textContent = formatTreasureValue(state.lootLog.totalValue);
  if (ui.inventorySlots) {
    const inventory = state.inventory || { baseSlots: 10, bonusSlots: 0, usedSlots: 0 };
    const capacity = Number(inventory.baseSlots ?? 10) + Number(inventory.bonusSlots ?? 0);
    ui.inventorySlots.textContent = `${inventory.usedSlots || 0} / ${capacity} slots`;
  }
}

function getCharacterActionContext(action) {
  const character = getActiveCharacter(state);
  const situational = Number(ui.searchModifierInput?.value || 0) || 0;
  const baseModifier = getCharacterActionModifier(character, action);
  const className = String(character?.className || "").toLowerCase();
  const advantageClassByAction = {
    break: hasGrit(character, 'STR') ? 'fighter' : '',
    search: "thief",
    disarm: "thief",
    pick: "thief"
  };
  const advantageClass = advantageClassByAction[action] || "";
  const hasAdvantage = Boolean(advantageClass && className === advantageClass);
  const hasDisadvantage = action === 'pick' && !isDarkvisionCharacter(character) && !isCharacterInLiveLight(character);
  return {
    character,
    modifier: baseModifier + situational,
    doubleRoll: hasAdvantage && !hasDisadvantage,
    disadvantage: hasDisadvantage && !hasAdvantage,
    advantageClass
  };
}

function formatRollText(result) {
  if (!result) {
    return "none";
  }
  const modifierText = result.modifier >= 0 ? `+${result.modifier}` : `${result.modifier}`;
  if (Number.isFinite(result.secondaryRoll)) {
    const kept = `*${result.roll}${modifierText}*`;
    const secondary = `${result.firstRoll}${modifierText}`;
    return `${kept} / ${secondary}`;
  }
  return `${result.roll}${modifierText}`;
}

function formatModifier(value) {
  const modifier = Number(value) || 0;
  return modifier >= 0 ? `+${modifier}` : `${modifier}`;
}

function createRandomDungeonSeed() {
  return Math.floor(Math.random() * 900000) + 100000;
}

function prettifyAttackName(value) {
  return String(value || "")
    .replace(/\b([A-Z]{2,})\b/g, (match) => match.charAt(0) + match.slice(1).toLowerCase())
    .replace(/\s+/g, " ")
    .trim();
}

function parseAttackText(attackText) {
  const normalized = String(attackText || "").replace(/^ATTACKS?:\s*/i, "").trim();
  if (!normalized) {
    return null;
  }
  const colonIndex = normalized.indexOf(":");
  if (colonIndex === -1) {
    return {
      name: prettifyAttackName(normalized),
      flag: "",
      bonus: 0,
      bonusText: "",
      detail: ""
    };
  }

  const namePart = normalized.slice(0, colonIndex).trim();
  const remainder = normalized.slice(colonIndex + 1).trim();
  const firstComma = remainder.indexOf(",");
  const firstChunk = firstComma === -1 ? remainder : remainder.slice(0, firstComma).trim();
  const rest = firstComma === -1 ? "" : remainder.slice(firstComma + 1).trim();
  const flagPattern=/\((?:C|N|F|V|FIN|2H|close|near|far)(?:\s*\/\s*(?:C|N|F|V|FIN|2H|close|near|far))*\)/i;
  const flagMatch = namePart.match(flagPattern) || firstChunk.match(flagPattern);
  const bonusMatch = firstChunk.match(/[+\-]\d+/);
  const cleanName = stripWeaponFlags(namePart);
  const detail = rest
    .replace(/\[[^\]]*\]/g, "")
    .replace(/\s*,\s*/g, ", ")
    .replace(/[\s,;]+$/, "")
    .replace(/\s+/g, " ")
    .trim();
  return {
    name: prettifyAttackName(cleanName || namePart),
    flag: flagMatch ? ` ${flagMatch[0]}` : "",
    bonus: bonusMatch ? Number.parseInt(bonusMatch[0], 10) : 0,
    bonusText: bonusMatch ? bonusMatch[0] : firstChunk,
    detail,
    damageExpression: extractDamageReferences(detail)[0]?.expression || ""
  };
}

function isThiefCharacter(character) {
  if(character?.companion?.kind==='doppelganger')return false;
  return /\bthief\b/i.test(String(character?.className || ""));
}

function isBackstabAttackText(attackText) {
  return /^backstab\b/i.test(String(attackText || "").replace(/^ATTACKS?:\s*/i, "").trim());
}

function getBackstabMultiplier(character) {
  return backstabMultiplier(character);
}

function multiplyDamageDice(expression, multiplier) {
  const normalized = normalizeDamageExpression(expression);
  if (!normalized || multiplier <= 1) {
    return normalized;
  }
  return normalized.replace(/(\d*)d(\d+)/gi, (match, count, sides) => {
    const diceCount = Number.parseInt(count || "1", 10);
    return `${diceCount * multiplier}d${sides}`;
  });
}

function applyAttackRoll(character, attack) {
  if (attack && isAttackEquipped(character, attack)) beginWeaponTargeting(character, attack);
}

function createAttackButton(character, attack) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "damage-token attack-roll-button";
  button.textContent = attack.name;
  button.title = `Roll attack ${attack.bonusText ? attack.bonusText : formatModifier(attack.bonus || 0)}`;
  if(getBackstabMultiplier(character))button.title+=`\nBackstab: ${multiplyDamageDice(getAttackDamageExpression(attack),getBackstabMultiplier(character))} damage`;
  button.addEventListener("click", (event) => {
    event.stopPropagation();
    applyAttackRoll(character, attack);
  });
  return button;
}

function getMonsterAttackDisplayName(monster) {
  const rawName = String(monster?.name || "monster").trim();
  return rawName ? rawName.toLowerCase() : "monster";
}

function applyMonsterAttackRoll(monster, attack) {
  if (isSharedRoom()) return;
  if (!ui.damageResult || !attack) {
    return;
  }
  const result = rollCheck(attack.bonus || 0);
  const monsterName = getMonsterAttackDisplayName(monster);
  const message = `The ${monsterName} attacks and rolls a ${result.total}.`;
  markUserActivity();
  setStatus(message);
  showCheckResult(result, "Attack", {
    headline: message,
    message: `${attack.name} ${attack.bonusText || formatModifier(attack.bonus || 0)}`
  });
}

function createMonsterAttackButton(monster, attack) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "damage-token attack-roll-button";
  button.textContent = attack.name;
  button.title = `Roll attack ${attack.bonusText || formatModifier(attack.bonus || 0)}`;
  button.disabled = isSharedRoom();
  button.addEventListener("click", (event) => {
    event.stopPropagation();
    applyMonsterAttackRoll(monster, attack);
  });
  return button;
}

function parseMonsterAttackSegment(segment) {
  const value = String(segment || "").trim();
  if (!value) {
    return null;
  }
  const match = value.match(/^(\d+\s+)?(.+?)\s*(\([^)]+\)\s*)?([+\-]\d+)\b(.*)$/);
  if (!match) {
    return null;
  }
  const [, count = "", rawName = "", range = "", bonusText = "", detail = ""] = match;
  const name = prettifyAttackName(rawName.trim());
  if (!name) {
    return null;
  }
  return {
    count,
    name,
    range,
    bonus: Number.parseInt(bonusText, 10) || 0,
    bonusText,
    detail
  };
}

function appendMonsterAttackSegment(target, segment, monster) {
  const attack = parseMonsterAttackSegment(segment);
  if (!attack) {
    appendDamageAwareText(target, segment, {
      sourceLabel: `${monster?.name || "Monster"} attack`
    });
    return;
  }
  if (attack.count) {
    target.append(document.createTextNode(attack.count));
  }
  target.append(createMonsterAttackButton(monster, attack));
  if (attack.range) {
    target.append(document.createTextNode(` ${attack.range.trim()}`));
  }
  target.append(document.createTextNode(` ${attack.bonusText}`));
  if (attack.detail) {
    appendDamageAwareText(target, attack.detail, {
      sourceLabel: `${monster?.name || "Monster"} attack`
    });
  }
}

function createMonsterAttackContent(monster) {
  const content = document.createElement("span");
  const value = String(monster?.attack || "").trim();
  if (!value) {
    content.textContent = "unknown";
    return content;
  }
  const parts = value.split(/(\s+\b(?:or|and)\b\s+)/i);
  for (const part of parts) {
    if (!part) {
      continue;
    }
    if (/^\s+\b(?:or|and)\b\s+$/i.test(part)) {
      content.append(document.createTextNode(part));
      continue;
    }
    appendMonsterAttackSegment(content, part, monster);
  }
  return content;
}

function parseSignedNumber(value, fallback = 0) {
  const match = String(value ?? "").match(/[+\-]?\d+/);
  return match ? Number.parseInt(match[0], 10) : fallback;
}

function getMonsterLevel(monster) {
  return Math.max(0, parseSignedNumber(monster?.level ?? monster?.lv ?? monster?.["**LV**"], 0));
}

function getMonsterAc(monster) {
  return Math.max(0, parseSignedNumber(monster?.ac ?? monster?.AC ?? monster?.["**AC**"], 10));
}

function getMonsterDexModifier(monster) {
  return parseSignedNumber(monster?.D ?? monster?.dex ?? monster?.["**D**"], 0);
}

function getMonsterTags(monster) {
  const tags = Array.isArray(monster?.tags)
    ? monster.tags
    : String(monster?.tags || "").split(",");
  return tags.map((tag) => String(tag || "").trim().toLowerCase()).filter(Boolean);
}

function getMonsterTagModifier(monster) {
  const values = getMonsterTags(monster)
    .map((tag) => ATTITUDE_TAG_MODIFIERS[tag])
    .filter((value) => Number.isFinite(Number(value)));
  if (!values.length) {
    return 0;
  }
  return Math.max(...values);
}

function monsterAllowsDiplomacy(monster) {
  return /^(?:y|yes|true|1)$/i.test(String(monster?.diplomacy ?? monster?.Diplomacy ?? monster?.["Diplomacy"] ?? "").trim());
}

function isLiveMonster(monster) {
  return monster?.type === "monster" && monster.defeated !== true && monster.leftPeacefully !== true;
}

function getLiveMonsters() {
  return (state?.entities || []).filter(isLiveMonster);
}

function getMonsterById(monsterId) {
  return getLiveMonsters().find((monster) => monster.id === monsterId) || null;
}

function isCharacterDead(character) {
  return character?.dead === true || character?.slain === true;
}

function isCharacterDying(character) {
  return !isCharacterDead(character) && Number(character?.dyingRounds || 0) > 0;
}

function isCharacterAbleToAct(character) {
  return character && !isCharacterDead(character) && !isCharacterDying(character) && !character.conditions?.paralyzed && !isSleeping(character, state) && !isRaving(character) && Number(character.hp) > 0;
}

function performRevive(character) {
  if (sendSharedCommand('revive', {}, character)) return;
  if (!character || !canControlCharacter(character) || !isCharacterDying(character) ||
      isCombatActive() && !isCurrentCharacterTurn(character)) throw new Error('Only the dying character may attempt to revive on their turn.');
  const key = isCombatActive() ? `${state.combat.round}:${state.combat.turnIndex}` : `crawl:${Math.floor(Date.now() / SPELL_ROUND_MS)}`;
  if (character.reviveTurnKey === key) throw new Error('Only one revive attempt is allowed per turn.');
  character.reviveTurnKey = key;
  const check = rollCheck(0);
  if (check.roll === 20) {
    setCharacterHp(character, 1);
    character.conditions ||= {}; character.conditions.prone = true;
    if (isCombatActive()) state.combat.movementRemaining = characterMovementBudget(character);
  } else decrementCharacterDyingRounds(character);
  syncCharacterDyingRaw(character);
  if (isCombatActive()) state.combat.actionUsed = check.roll !== 20;
  const message = `${character.name} rolls ${check.roll} to revive: ${check.roll === 20 ? 'revives with 1 HP!' : character.dead ? 'dies.' : `still dying (${character.dyingRounds} rounds left).`}`;
  pushDiceHistory('Revive', message, character.id, rollTextSegments(message, check)); setStatus(message); markRunDirty();
  checkCombatEnd(); updatePanels(); render(); scheduleAutoEndTurnIfNeeded();
}

function performStand(character) {
  if (sendSharedCommand('stand', {}, character)) return;
  if (!canControlCharacter(character) || !isCharacterAbleToAct(character) || isCombatActive() && !isCurrentCharacterTurn(character)) return;
  const budget = characterMovementBudget(character);
  const remaining = standCreature(character, budget, isCombatActive() ? state.combat.movementRemaining : budget, state);
  if (isCombatActive()) state.combat.movementRemaining = remaining;
  markRunDirty(); setStatus(`${character.name} stands up.`); updatePanels(); render();
}

function performWake(actor, targetId) {
  if (sendSharedCommand('wake', { target_id: targetId }, actor)) return;
  const target = [...state.characters, ...state.entities.filter(entity => entity.type === 'monster')].find(creature => creature.id === targetId);
  if (!actor || actor.id === targetId || !isCharacterAbleToAct(actor) || !isSleeping(target, state) ||
      !canTargetAtRange(state, actor, target, 1, { requireLight: false })) throw new Error('An awake adjacent character must wake the sleeping creature.');
  if (!consumeCharacterCombatAction(actor)) return;
  wakeCreature(target, state); markRunDirty(); recomputeVisibility(state);
  setStatus(`${actor.name} wakes ${target.name}.`); updatePanels(); render();
}

function performPhase(character) {
  if (sendSharedCommand('phase', {}, character)) return;
  if (!canPhase(character) || !isCharacterAbleToAct(character) || !canControlCharacter(character)) throw new Error('This creature cannot become incorporeal.');
  if (!isIncorporeal(character) && !consumeCharacterCombatAction(character)) return;
  if (isIncorporeal(character)) {
    if (getTileAt(character.x, character.y)?.type !== 'floor') throw new Error('Move out of solid terrain before becoming corporeal.');
    if (!consumeCharacterCombatAction(character)) return;
  }
  character.conditions ||= {}; character.conditions.incorporeal = !isIncorporeal(character);
  markRunDirty(); setStatus(`${character.name} becomes ${isIncorporeal(character) ? 'incorporeal' : 'corporeal'}.`); updatePanels(); render();
}

function interactAtDoor(x, y, actor) {
  const door = getDoorAt(state, x, y);
  if (portalHeld(door)) {
    if (!actor) return { message: 'Hold Portal seals this door.' };
    if (!SERVER_RUNTIME && !consumeCharacterCombatAction(actor)) return { message: 'This character has already acted.' };
    const attempt = forceHeldDoor(door, actor, modifier => rollCheck(modifier, { doubleRoll: hasGrit(actor, 'STR') }));
    pushDiceHistory('Hold Portal', attempt.message, actor.id, rollTextSegments(attempt.message, attempt.result));
    recomputeVisibility(state); return { message: attempt.message };
  }
  return clickEntity(state, x, y, { characterId: actor?.id });
}

function inventoryController(character) {
  return isFloatingDisc(character) ? state.characters.find(member => member.id === character.summon.casterId) : character;
}

function canUseCharacterInventory(character) {
  return Boolean(character) && !isIncorporeal(character) && !isTied(inventoryController(character)) && isCharacterAbleToAct(inventoryController(character));
}

function isCharacterTargetableByMonster(character) {
  return character && !isFloatingDisc(character) && !isCharacterDead(character) && !isStealthed(character) && hasCharacterMapPosition(character);
}

function getCombatCharacters() {
  return (state?.characters || []).filter((character) => !isFloatingDisc(character) && !isCharacterDead(character));
}

function getMonsterDistanceToCharacter(monster, character) {
  if (!monster || !hasCharacterMapPosition(character)) {
    return Infinity;
  }
  return Math.max(Math.abs(Number(monster.x) - Number(character.x)), Math.abs(Number(monster.y) - Number(character.y)));
}

function canMonsterSeeCharacter(monster, character) {
  return isLiveMonster(monster) &&
    !isSleeping(monster, state) &&
    isCharacterTargetableByMonster(character) &&
    sameRoute(state, monster, character) && (isIncorporeal(monster) || creatureSight(monster, character));
}

function creatureSight(source, target) {
  return !source.conditions?.blind && hasLineOfSightFrom(state, Number(source.x), Number(source.y), Number(target.x), Number(target.y), { source, target });
}

function canCharacterSeeMonster(character, monster, { includeInvisible = false } = {}) {
  return !isFloatingDisc(character) && isCharacterAbleToAct(character) &&
    hasCharacterMapPosition(character) &&
    isLiveMonster(monster) &&
    (includeInvisible || !isInvisible(monster) || character.magicDetectedIds?.includes(monster.id)) && isMonsterCurrentlyVisible(state, monster, { viewer: character });
}

function ensureCombatState() {
  if (!state.combat) {
    state.combat = {};
  }
  state.combat.active = state.combat.active === true;
  state.combat.round = Math.max(0, Number.parseInt(state.combat.round ?? 0, 10) || 0);
  state.combat.turnIndex = Math.max(0, Number.parseInt(state.combat.turnIndex ?? 0, 10) || 0);
  state.combat.turnOrder = Array.isArray(state.combat.turnOrder) ? state.combat.turnOrder : [];
  state.combat.playerOrderIds = Array.isArray(state.combat.playerOrderIds) ? state.combat.playerOrderIds : [];
  state.combat.pendingPlayerIds = Array.isArray(state.combat.pendingPlayerIds) ? state.combat.pendingPlayerIds : [];
  state.combat.monsterIds = Array.isArray(state.combat.monsterIds) ? state.combat.monsterIds : [];
  state.combat.sideFirst = state.combat.sideFirst === "monsters" ? "monsters" : "characters";
  state.combat.movementRemaining = Math.max(0, Number.parseInt(state.combat.movementRemaining ?? 0, 10) || 0);
  state.combat.actionUsed = state.combat.actionUsed === true;
  state.combat.autoRunning = state.combat.autoRunning === true;
  state.combat.initiative = Array.isArray(state.combat.initiative) ? state.combat.initiative : [];
  state.combat.log = Array.isArray(state.combat.log) ? state.combat.log.slice(-12) : [];
  return state.combat;
}

function isCombatActive() {
  return state?.combat?.active === true;
}

function pushCombatLog(message) {
  const text = String(message || "").trim();
  if (!text) {
    return;
  }
  const combat = ensureCombatState();
  combat.log.push(text);
  combat.log = combat.log.slice(-12);
}

function admitPendingCombatCharacters(combat = ensureCombatState()) {
  const pending = Array.isArray(combat.pendingPlayerIds) ? combat.pendingPlayerIds : [];
  if (!pending.length) {
    combat.pendingPlayerIds = [];
    return [];
  }
  const admitted = [];
  const existing = new Set(combat.playerOrderIds);
  for (const characterId of pending) {
    const character = state.characters.find((candidate) => candidate.id === characterId && !isCharacterDead(candidate));
    if (!character || existing.has(characterId)) {
      continue;
    }
    combat.playerOrderIds.push(characterId);
    existing.add(characterId);
    admitted.push(character.name || "Character");
  }
  combat.pendingPlayerIds = [];
  if (admitted.length) {
    pushCombatLog(`${admitted.join(", ")} join${admitted.length === 1 ? "s" : ""} combat this round.`);
  }
  return admitted;
}

function beginNextCombatRound(combat = ensureCombatState()) {
  progressWizardEffects(SPELL_ROUND_MS, { rounds: 1 });
  combat.round += 1;
  combat.surpriseRound = false;
  admitPendingCombatCharacters(combat);
  combat.turnIndex = 0;
  combat.turnOrder = buildCombatTurnOrder(combat.sideFirst, combat.playerOrderIds, combat.monsterIds);
}

function queueCharactersForNextCombatRound(characters) {
  if (!isCombatActive()) {
    return;
  }
  const combat = ensureCombatState();
  const existing = new Set([
    ...combat.playerOrderIds,
    ...combat.pendingPlayerIds
  ]);
  const queued = [];
  for (const character of characters || []) {
    if (!character?.id || isFloatingDisc(character) || isCharacterDead(character) || existing.has(character.id)) {
      continue;
    }
    combat.pendingPlayerIds.push(character.id);
    existing.add(character.id);
    queued.push(character.name || "Character");
  }
  if (queued.length) {
    pushCombatLog(`${queued.join(", ")} will join combat next round.`);
  }
}

function removeDeadCharactersFromCombat(combat = ensureCombatState()) {
  if (!combat.active) {
    return false;
  }
  const deadIds = new Set(
    (state.characters || [])
      .filter(isCharacterDead)
      .map((character) => character.id)
      .filter(Boolean)
  );
  if (!deadIds.size) {
    return false;
  }

  const previousTurnIndex = combat.turnIndex;
  let removedBeforeCurrent = 0;
  let removedCurrent = false;
  let changed = false;

  combat.turnOrder = combat.turnOrder.filter((entry, index) => {
    const remove = entry.type === "character" && deadIds.has(entry.id);
    if (!remove) {
      return true;
    }
    changed = true;
    if (index < previousTurnIndex) {
      removedBeforeCurrent += 1;
    }
    if (index === previousTurnIndex) {
      removedCurrent = true;
    }
    return false;
  });

  const filterAlive = (id) => !deadIds.has(id);
  const nextPlayerOrderIds = combat.playerOrderIds.filter(filterAlive);
  const nextPendingPlayerIds = combat.pendingPlayerIds.filter(filterAlive);
  changed = changed ||
    nextPlayerOrderIds.length !== combat.playerOrderIds.length ||
    nextPendingPlayerIds.length !== combat.pendingPlayerIds.length;
  combat.playerOrderIds = nextPlayerOrderIds;
  combat.pendingPlayerIds = nextPendingPlayerIds;

  if (!combat.turnOrder.length) {
    combat.turnIndex = 0;
    return changed;
  }
  if (removedCurrent) {
    combat.turnIndex = previousTurnIndex % combat.turnOrder.length;
  } else {
    combat.turnIndex = Math.max(0, previousTurnIndex - removedBeforeCurrent);
    if (combat.turnIndex >= combat.turnOrder.length) {
      combat.turnIndex = 0;
    }
  }
  return changed;
}

function clearAutoEndTurnTimer() {
  if (autoEndTurnTimer) {
    window.clearTimeout(autoEndTurnTimer);
    autoEndTurnTimer = null;
  }
}

function shouldAutoEndCurrentCharacterTurn() {
  if (state?.characters.some(character => character.pendingFall)) return false;
  if (!isCombatActive()) {
    return false;
  }
  const combat = ensureCombatState();
  const entry = getCurrentCombatEntry();
  if (state.characters.find(character => character.id === entry?.id)?.pendingSpell) return false;
  const actor = state.characters.find(character => character.id === entry?.id);
  if (actor?.pendingSteal) return false;
  if (isCharacterDying(actor) && actor.reviveTurnKey !== `${combat.round}:${combat.turnIndex}`) return false;
  return entry?.type === "character" && combat.actionUsed === true &&
    combat.movementRemaining < movementStepCost(state, Number(actor?.x), Number(actor?.y), actor);
}

function scheduleAutoEndTurnIfNeeded(delayMs = 300) {
  if (SERVER_RUNTIME || isSharedRoom()) return;
  clearAutoEndTurnTimer();
  if (!shouldAutoEndCurrentCharacterTurn()) {
    return;
  }
  const entry = getCurrentCombatEntry();
  const turnIndex = state.combat.turnIndex;
  autoEndTurnTimer = window.setTimeout(() => {
    autoEndTurnTimer = null;
    const current = getCurrentCombatEntry();
    if (
      isCombatActive() &&
      current?.type === entry?.type &&
      current?.id === entry?.id &&
      state.combat.turnIndex === turnIndex &&
      shouldAutoEndCurrentCharacterTurn()
    ) {
      advanceCombatTurn();
    }
  }, delayMs);
}

function getCurrentCombatEntry() {
  const combat = ensureCombatState();
  return combat.active ? combat.turnOrder[combat.turnIndex] || null : null;
}

function isCurrentCharacterTurn(character) {
  const entry = getCurrentCombatEntry();
  return entry?.type === "character" && entry.id === inventoryController(character)?.id;
}

function buildCombatTurnOrder(sideFirst, playerOrderIds, monsterIds) {
  const playerEntries = playerOrderIds
    .filter((id) => state.characters.some((character) => character.id === id && !isCharacterDead(character)))
    .map((id) => ({ type: "character", id }));
  const monsterEntries = monsterIds
    .filter((id) => Boolean(getMonsterById(id)))
    .map((id) => ({ type: "monster", id }));
  const order = sideFirst === "monsters"
    ? [...monsterEntries, ...playerEntries]
    : [...playerEntries, ...monsterEntries];
  return state.combat?.surpriseRound ? order.filter(entry => state.combat.surpriseParticipantIds.includes(entry.id)) : order;
}

function compareInitiativeEntries(a, b) {
  if (b.total !== a.total) {
    return b.total - a.total;
  }
  return a.tie - b.tie;
}

function rollInitiative(extraMonsterIds = []) {
  const characters = getCombatCharacters();
  const monsterIds = [...new Set([...getMonstersWithCharacterLineOfSight().filter(monster => monster.hostile || ['combat','hostile'].includes(monster.attitude) ||
    isStealthed(monster)&&state.characters.some(character=>Math.hypot(character.x-monster.x,character.y-monster.y)<=12)).map(monster => monster.id),...extraMonsterIds])];
  const monsterSet = new Set(monsterIds);
  const monsters = getLiveMonsters().filter((monster) => monsterSet.has(monster.id));
  const playerRolls = characters.map((character, index) => {
    const modifier = abilityScoreModifier(character?.stats?.DEX);
    let roll = Math.floor(Math.random() * 20) + 1;
    if ((character.bonuses || []).some(bonus => /initiative/i.test(`${bonus.name} ${bonus.bonusTo}`))) roll = Math.max(roll, Math.floor(Math.random() * 20) + 1);
    return {
      type: "character",
      id: character.id,
      name: character.name || "Character",
      partyIndex: index,
      roll,
      modifier,
      total: roll + modifier,
      tie: Math.random()
    };
  });
  const monsterRolls = monsters.map((monster, index) => {
    const modifier = getMonsterDexModifier(monster);
    const roll = Math.floor(Math.random() * 20) + 1;
    return {
      type: "monster",
      id: monster.id,
      name: monster.name || "Monster",
      monsterIndex: index,
      roll,
      modifier,
      total: roll + modifier,
      tie: Math.random()
    };
  });
  return {
    playerRolls,
    monsterRolls,
    monsterIds,
    allRolls: [...playerRolls, ...monsterRolls].sort(compareInitiativeEntries)
  };
}

function getPlayerInitiativeOrder(playerRolls) {
  if (!playerRolls.length) {
    return [];
  }
  const sorted = playerRolls.slice().sort(compareInitiativeEntries);
  const highest = sorted[0];
  const second = sorted[1] || sorted[0];
  const partyIds = state.characters
    .filter((character) => !isFloatingDisc(character) && !isCharacterDead(character))
    .map((character) => character.id);
  const count = partyIds.length;
  if (count <= 1) {
    return partyIds;
  }
  const start = partyIds.indexOf(highest.id);
  const secondIndex = partyIds.indexOf(second.id);
  if (start === -1 || secondIndex === -1 || start === secondIndex) {
    return partyIds;
  }
  const downDistance = (secondIndex - start + count) % count;
  const upDistance = (start - secondIndex + count) % count;
  const direction = downDistance < upDistance ? 1 : upDistance < downDistance ? -1 : Math.random() < 0.5 ? 1 : -1;
  const ordered = [];
  for (let offset = 0; offset < count; offset += 1) {
    ordered.push(partyIds[(start + direction * offset + count) % count]);
  }
  return ordered;
}

function getMonstersWithCharacterLineOfSight(candidates = getLiveMonsters()) {
  return candidates.filter((monster) => {
    return (state.characters || []).some((character) => canMonsterSeeCharacter(monster, character));
  });
}

function beginCombat(reason = "Combat begins.", { initiator = null, forcedSurprisedIds = [], extraMonsterIds = [], monsterAmbush = false } = {}) {
  if (state.characters.some(character => OFFENSIVE_SPELLS.has(character.pendingSpell?.spell) && character.pendingSpell.phase === 'critical')) return false;
  ensureCombatState();
  const initiative = rollInitiative(extraMonsterIds);
  if (!initiative.monsterIds.length || !initiative.playerRolls.length) {
    return false;
  }
  if (state.rest?.phase === 'sleeping') {
    interruptPartyRest(state);
    recordRestInterruptionChecks();
  } else if (state.rest?.phase === 'voting') cancelPartyRest(state, 'Rest invitation cancelled by combat.');
  const alarmedRest = state.rest?.phase === 'interrupted' && state.rest.ambushPending && Boolean(state.rest.alarm);
  const restAmbush = state.rest?.phase === 'interrupted' && state.rest.ambushPending && !alarmedRest;
  if (alarmedRest) initiator = null;
  const watchers = restAmbush ? new Set(state.rest.interruptedWatchIds || []) : null;
  if (state.rest?.ambushPending) state.rest.ambushPending = false;
  const top = initiative.allRolls[0];
  const sideFirst = top?.type === "monster" ? "monsters" : "characters";
  const playerOrderIds = getPlayerInitiativeOrder(initiative.playerRolls);
  const surpriseIds = restAmbush ? [...initiative.monsterIds, ...playerOrderIds.filter(id =>
    watchers.has(id) || neverSurprised(state.characters.find(character => character.id === id)))]
    : monsterAmbush ? [...initiative.monsterIds, ...playerOrderIds.filter(id => neverSurprised(state.characters.find(character => character.id === id)))]
    : initiator ? surpriseParticipants(state, initiator, { forcedSurprisedIds }) : [];
  state.combat = {
    active: true,
    round: initiator || restAmbush ? 0 : 1,
    surpriseRound: Boolean(initiator || restAmbush),
    surpriseParticipantIds: surpriseIds,
    turnIndex: 0,
    sideFirst,
    playerOrderIds,
    pendingPlayerIds: [],
    monsterIds: initiative.monsterIds,
    turnOrder: buildCombatTurnOrder(sideFirst, playerOrderIds, initiative.monsterIds),
    movementRemaining: 0,
    actionUsed: false,
    initiative: initiative.allRolls,
    log: []
  };
  state.combat.turnOrder = buildCombatTurnOrder(sideFirst,playerOrderIds,initiative.monsterIds);
  for (const monsterId of initiative.monsterIds) {
    const monster = getMonsterById(monsterId);
    if (monster) {
      monster.attitude = "combat";
      monster.attitudeChecked = true;
    }
  }
  for (const character of state.characters) if (hasReadyOffensiveSpell(character)) character.openingSpellActionSpent = true;
  pushCombatLog(reason);
  announceCombatBegins();
  startCurrentCombatTurn();
  return true;
}

function addMonstersToCombat(monsters, reason = "More monsters join the fight.") {
  if (!isCombatActive()) {
    return beginCombat(reason);
  }
  const combat = ensureCombatState();
  const added = [];
  for (const monster of monsters) {
    if (!isLiveMonster(monster) || combat.monsterIds.includes(monster.id)) {
      continue;
    }
    monster.attitude = "combat";
    monster.attitudeChecked = true;
    combat.monsterIds.push(monster.id);
    combat.turnOrder.push({ type: "monster", id: monster.id });
    added.push(monster.name || "Monster");
  }
  if (added.length) {
    pushCombatLog(`${reason} ${added.join(", ")}.`);
  }
  return added.length > 0;
}

function endCombat(message = "Combat ends.") {
  const combat = ensureCombatState();
  combat.active = false;
  combat.round = 0;
  combat.turnIndex = 0;
  combat.turnOrder = [];
  combat.monsterIds = [];
  combat.playerOrderIds = [];
  combat.pendingPlayerIds = [];
  combat.movementRemaining = 0;
  combat.actionUsed = false;
  combat.log = [];
  combat.autoRunning = false;
  clearAutoEndTurnTimer();
  settleCompanionsAfterCombat();
  setStatus(message);
  announceCombatOver();
  markRunDirty();
}

function checkCombatEnd() {
  if (!isCombatActive()) {
    return true;
  }
  const combat = ensureCombatState();
  for (const event of processMorale(state, {sourceId: state.lastDamageSourceId})) {pushCombatLog(event.message);pushDiceHistory('Morale',event.message);}
  removeDeadCharactersFromCombat(combat);
  combat.monsterIds = combat.monsterIds.filter((id) => Boolean(getMonsterById(id)));
  const liveCombatMonsters = combat.monsterIds.map(getMonsterById).filter(Boolean);
  const livingCharacters = getCombatCharacters();
  if (!liveCombatMonsters.length) {
    endCombat("Combat ends. All monsters are defeated.");
    return true;
  }
  if (!livingCharacters.length) {
    endCombat("Combat ends. All characters are dead.");
    return true;
  }
  const anyMonsterCanSee = liveCombatMonsters.some(monster => livingCharacters.some(character =>
    sameRoute(state, monster, character) && (isIncorporeal(monster) || creatureSight(monster, character))));
  const pursuit = !anyMonsterCanSee && liveCombatMonsters.some(monster => !isSleeping(monster, state) && livingCharacters.some(character =>
    getMonsterDistanceToCharacter(monster, character) <= 12 && findPursuitStep(state, monster, character, {
      canStep: (x, y, nx, ny, point) => canMoveBetweenTiles(state, x, y, nx, ny, { ignoreClosedDoors: true, routeId: point.routeId }).ok,
      canAttackFrom: (x, y) => Math.max(Math.abs(x - character.x), Math.abs(y - character.y)) <= 1,
      maxNodes: 2048
    })));
  if (!anyMonsterCanSee && !pursuit) {
    endCombat("Combat ends. The monsters have lost line of sight.");
    return true;
  }
  combat.turnOrder = combat.turnOrder.filter((entry) => entry.type === "monster" || state.characters.some((character) => character.id === entry.id && !isCharacterDead(character)));
  // The turn-advance caller starts the next round after the final entry.
  return false;
}

function detectAdditionalCombatMonsters() {
  if (!isCombatActive()) {
    return;
  }
  const combat = ensureCombatState();
  const combatMonsterSet = new Set(combat.monsterIds);
  const combatMonsters = combat.monsterIds.map(getMonsterById).filter(Boolean);
  const candidates = getLiveMonsters().filter(monster => !combatMonsterSet.has(monster.id) &&
    (monster.hostile || ['combat','hostile'].includes(monster.attitude)) && !isHiddenMonster(monster));
  const joining = candidates.filter((monster) => {
    if ((state.characters || []).some((character) => canMonsterSeeCharacter(monster, character))) {
      return true;
    }
    return combatMonsters.some((combatMonster) => (
      creatureSight(monster, combatMonster)
    ));
  });
  if (joining.length) {
    addMonstersToCombat(joining, "A monster notices the fight.");
  }
}

function syncCharacterDyingRaw(character) {
  if (!character) {
    return;
  }
  character.raw = character.raw || {};
  character.raw.dead = character.dead === true;
  character.raw.slain = character.slain === true;
  character.raw.dyingRounds = Math.max(0, Number(character.dyingRounds || 0) || 0);
}

function startCurrentCombatTurn() {
  if (!isCombatActive() || checkCombatEnd()) {
    return;
  }
  const combat = ensureCombatState();
  clearAutoEndTurnTimer();
  if (!combat.turnOrder.length) {
    endCombat("Combat ends.");
    return;
  }
  if (combat.turnIndex >= combat.turnOrder.length) {
    beginNextCombatRound(combat);
  }
  const entry = getCurrentCombatEntry();
  if (!entry) {
    endCombat("Combat ends.");
    return;
  }
  if (entry.type === "monster") {
    if (SERVER_RUNTIME) serverMonsterTurns = runAutoMonsterTurns();
    else void runAutoMonsterTurns();
    return;
  }
  const character = state.characters.find((candidate) => candidate.id === entry.id);
  if (!character || isCharacterDead(character)) {
    advanceCombatTurn();
    return;
  }
  setActiveCharacter(state, character.id);
  syncPlayerToActiveCharacter();
  if (character.conditions?.sinkhole) character.conditions.sinkholeMovementSpent = 0;
  combat.movementBudget = characterMovementBudget(character);
  combat.movementRemaining = combat.movementBudget;
  combat.lastUnoccupiedPosition = { x: Number(character.x), y: Number(character.y), roomId: character.roomId, routeId: routeOf(state, character) };
  combat.actionUsed = character.openingSpellActionSpent === true;
  character.openingSpellActionSpent = false;
  if (isCharacterDying(character)) {
    combat.movementRemaining = 0;
    combat.actionUsed = false;
    setStatus(character.dead
      ? `${character.name} dies.`
      : `${character.name} is dying in ${character.dyingRounds} ${character.dyingRounds === 1 ? "round" : "rounds"}.`);
    if (character.dead) {
      pushCombatLog(`${character.name || "Character"} dies.`);
      removeDeadCharactersFromCombat(combat);
      if (checkCombatEnd()) {
        render();
        updatePanels();
        return;
      }
      render();
      updatePanels();
      startCurrentCombatTurn();
      return;
    }
  } else if (isSleeping(character, state) || isRaving(character) || character.conditions?.paralyzed) {
    combat.movementRemaining = 0;
    combat.actionUsed = true;
    setStatus(`${character.name} is ${isRaving(character) ? 'raving' : character.conditions?.paralyzed ? 'paralyzed' : 'sleeping'}.`);
  } else {
    setStatus(`Round ${combat.round}: ${character.name || "Character"}'s turn.`);
    recordWizardTurn(character);
    const turnKey = combat.round + ':' + character.id;
    if (character.focusSpell && character.focusSpell.lastTurn !== turnKey) {
      if (!isTierTwoFocus(character.focusSpell) || character.focusSpell.spell === 'levitate') character.focusSpell.lastTurn = turnKey;
      recordFocusCheck(character, 'next round');
    }
  }
  announceCurrentTurn(entry);
  scheduleAutoEndTurnIfNeeded(650);
}

function advanceCombatTurn() {
  if (!isCombatActive()) {
    return;
  }
  const combat = ensureCombatState();
  const previous = state.characters.find(character => character.id === getCurrentCombatEntry()?.id);
  if (hasReadyOffensiveSpell(previous)) {
    previous.pendingSpell = null;
    previous.lastMagicMissile = null;
  }
  if (!SERVER_RUNTIME) { targetingMode = null; missileDisplay = null; }
  clearAutoEndTurnTimer();
  detectAdditionalCombatMonsters();
  if (checkCombatEnd()) {
    render();
    updatePanels();
    return;
  }
  combat.turnIndex += 1;
  if (combat.turnIndex >= combat.turnOrder.length) {
    beginNextCombatRound(combat);
  }
  startCurrentCombatTurn();
  render();
  updatePanels();
}

function endCurrentTurn() {
  if (restInProgress(state)) return;
  if (getActiveCharacter(state)?.pendingSpell && !hasReadyOffensiveSpell(getActiveCharacter(state))) { setStatus(pendingSpellMessage(getActiveCharacter(state))); return; }
  if (sendSharedCommand("end_turn")) return;
  const entry = getCurrentCombatEntry();
  if (!entry || entry.type !== "character") {
    setStatus("It is not a character turn.");
    return;
  }
  const character = getActiveCharacter(state);
  if (isCharacterDying(character) && character.reviveTurnKey !== `${state.combat.round}:${state.combat.turnIndex}`) { performRevive(character); return; }
  const occupant = characterOccupant(state, Number(character.x), Number(character.y), character.id);
  if (occupant) {
    if (state.combat.lastUnoccupiedPosition) Object.assign(character, state.combat.lastUnoccupiedPosition);
    syncPlayerToActiveCharacter();
    recomputeVisibility(state);
    setStatus(`${character.name} can't end turn on ${occupant.name}'s token.`);
    render(); updatePanels();
    return;
  }
  character.pendingSteal = null;
  advanceCombatTurn();
  ui.mapHost?.focus?.();
}

function syncCharacterStealthRaw(character) {
  if (!character) {
    return;
  }
  character.raw = character.raw || {};
  character.raw.stealthed = character.stealthed === true;
  character.raw.stealthRoll = character.stealthRoll || null;
}

function setCharacterStealthed(character, stealthed, check = null) {
  if (!character) {
    return;
  }
  character.stealthed = stealthed === true;
  character.stealthRoll = check ? {
    total: check.total,
    roll: check.roll,
    firstRoll: check.firstRoll,
    secondaryRoll: check.secondaryRoll,
    checkMode: check.checkMode,
    modifier: check.modifier
  } : null;
  syncCharacterStealthRaw(character);
}

function characterWearsHeavyStealthArmor(character) {
  return (Array.isArray(character?.gear) ? character.gear : []).some((item) => {
    const text = `${item?.name || ""} ${item?.treasureKind || ""} ${item?.kind || ""}`.toLowerCase();
    return /\b(?:chain\s*mail|plate\s*mail|platemail|plate armor)\b/.test(text);
  });
}

function performStealth() {
  if (sendSharedCommand("stealth")) return;
  const character = getActiveCharacter(state);
  if (isInvisible(character)) { setStatus(`${character.name} is already successfully stealthed by invisibility.`); return; }
  if (!character) {
    setStatus("Select a character to attempt stealth.");
    return;
  }
  if (isCombatActive()) {
    if (!isCurrentCharacterTurn(character)) {
      setStatus("Only the character whose turn it is can attempt stealth.");
      return;
    }
    if (state.combat.actionUsed || hasAlterSelfFeature(character, 'claws') && remainingClawAttacks(state, character) === 1) {
      setStatus(`${character.name} has already acted this turn.`);
      return;
    }
  }
  if (!isCharacterAbleToAct(character)) {
    setStatus(`${character.name || "Character"} can't attempt stealth.`);
    return;
  }
  const modifier = abilityScoreModifier(character?.stats?.DEX);
  const advantage = /\bthief\b/i.test(String(character.className || ""));
  const disadvantage = characterWearsHeavyStealthArmor(character);
  const check = silenceStealthSuccess(state, character) ? { roll: 20, rolls: [20], total: 20 + modifier, modifier, checkMode: 'normal' } : rollCheck(modifier, {
    doubleRoll: advantage && !disadvantage,
    disadvantage: disadvantage && !advantage
  });
  const success = check.total >= 10;
  setCharacterStealthed(character, success, check);
  if (isCombatActive()) {
    state.combat.actionUsed = true;
  }
  const mode = check.checkMode === "normal" ? "" : ` (${check.checkMode})`;
  const message = success
    ? `${character.name} stealth ${check.total}${mode}: stealthed.`
    : `${character.name} stealth ${check.total}${mode}: not hidden.`;
  markUserActivity();
  markRunDirty();
  setStatus(message);
  showCheckResult(check, "Stealth", {
    headline: `Stealth ${check.total}`,
    message
  });
  processMonsterVisibilityChange();
  scheduleAutoEndTurnIfNeeded();
  render();
  updatePanels();
}

function beginSteal(character) {
  if (sendSharedCommand('steal', {}, character)) return;
  if (!isThief(character) || !isStealthed(character) || !isCharacterAbleToAct(character) || isIncorporeal(character)) throw new Error('A hidden corporeal thief is required.');
  targetingMode = null;
  if (!consumeCharacterCombatAction(character)) return;
  const check = rollCheck(abilityScoreModifier(character.stats?.DEX), { doubleRoll: true });
  const message = `${character.name} attempts to steal at advantage: (${check.firstRoll})(${check.secondaryRoll}) +${check.modifier} DEX = ${check.total} vs DC 15.`;
  pushDiceHistory('Steal', message, character.id, rollTextSegments(message, check)); setStatus(message);
  if (check.total < 15) { setCharacterStealthed(character, false); character.pendingSteal = null; }
  else character.pendingSteal = { check, phase: 'targeting', turnKey: targetingTurnKey() };
  if (!SERVER_RUNTIME && character.pendingSteal) targetingMode = { kind: 'steal', characterId: character.id, turnKey: targetingTurnKey() };
  markRunDirty(); updatePanels(); render();
}

function resolveSteal(character, { targetId, index, cancel = false } = {}) {
  const type = cancel ? 'steal_cancel' : Number.isInteger(index) ? 'steal_take' : 'steal_target';
  if (sendSharedCommand(type, { target_id: targetId, gear_index: index }, character)) return;
  if (cancel) { character.pendingSteal = null; targetingMode = null; }
  else {
    if (!character.pendingSteal || character.pendingSteal.turnKey !== targetingTurnKey()) throw new Error('The steal attempt has ended.');
    if (!Number.isInteger(index)) setStatus(selectStealTarget(state, character, getMonsterById(targetId)).message);
    else {
      const { item, monster } = takeStolenItem(state, character, index);
      if (getCharacterGearFreeSlots(character) >= getPickupSlotCost(character, item)) character.gear.push(item);
      else {
        const tile = [[0,-1],[1,0],[0,1],[-1,0],[1,1],[-1,1],[1,-1],[-1,-1]].map(([dx,dy]) => ({ x: character.x + dx, y: character.y + dy }))
          .find(point => canMoveBetweenTiles(state, character.x, character.y, point.x, point.y).ok) || findEquipmentDropTile(character);
        tile.roomId = getTileAt(tile.x, tile.y)?.roomId ?? null;
        addDroppedGearPile(item, tile, item.lit ? getGearLightSource(item) : '');
      }
      character.raw.gear = structuredClone(character.gear);
      pushDiceHistory('Steal', `${character.name} steals ${item.name} from ${monster.name}.`, character.id);
      setStatus(`${character.name} steals ${item.name}.`); targetingMode = null;
    }
  }
  markRunDirty(); syncAllCharacterEquipmentDerivedStats(); updatePanels(); render();
}

function syncStealUi() {
  if (SERVER_RUNTIME) return;
  const modal = document.getElementById('steal-modal');
  const thief = state.characters.find(character => character.pendingSteal?.phase === 'gear' && canControlCharacter(character));
  modal.hidden = !thief;
  const list = document.getElementById('steal-items'); list.replaceChildren();
  if (!thief) return;
  const monster = getMonsterById(thief.pendingSteal.targetId);
  if (monster) for (const { item, index } of stealableGear(monster)) {
    const button = document.createElement('button'); button.type = 'button'; button.textContent = item.name;
    button.addEventListener('click', () => resolveSteal(thief, { index })); list.append(button);
  }
}

function getAttackDamageExpression(attack) {
  const explicit = attack?.damageExpression || extractDamageReferences(attack?.detail || "")[0]?.expression || "";
  if (explicit) {
    return explicit;
  }
  const flatMatch = String(attack?.detail || "").match(/\((\d+)\b/) || String(attack?.detail || '').match(/^\s*(\d+)(?:\s*,|\s*$)/);
  return flatMatch ? flatMatch[1] : "";
}

function getAttackRangeInfo(attackText, attack = null) {
  const text = `${attackText || ""} ${attack?.range || ""} ${attack?.flag || ""} ${attack?.detail || ""}`.toLowerCase();
  const hasClose = /\b(?:close|melee|c)\b/.test(text);
  const hasNear = /\bnear\b/.test(text);
  const hasFar = /\bfar\b/.test(text);
  const profile = getWeaponProfileFromText(attack?.name || attackText || "");
  const inferred = profile?.key === "longbow" || profile?.key === "shortbow" || profile?.key === "crossbow"
    ? "near"
    : "close";
  const ranges = new Set();
  if (hasClose) ranges.add("close");
  if (hasNear) ranges.add("near");
  if (hasFar) ranges.add("far");
  if (!ranges.size) {
    ranges.add(inferred);
    if (profile?.thrown) ranges.add(profile.key === "javelin" ? "far" : "near");
  }
  const maxRange = Math.max(...Array.from(ranges).map((range) => RANGE_LIMITS[range] || 1));
  return {
    ranges,
    maxRange,
    isCloseOnly: ranges.has("close") && ranges.size === 1,
    hasNear: ranges.has("near"),
    hasClose: ranges.has("close")
  };
}

function getFirstCombatAttack(character) {
  const attackText = getRenderableAttacks(character)
    .find(candidate => {
      const attack = parseAttackText(candidate);
      return attack?.name === "Unarmed" || (getAttackGearIndex(character, attack) >= 0 && isAttackEquipped(character, attack));
    }) || "";
  const attack = parseAttackText(attackText);
  if (!attack) {
    return null;
  }
  return {
    attackText,
    attack,
    range: getAttackRangeInfo(attackText, attack)
  };
}

function getCombatAttackFromParsedAttack(attack, attackText = "") {
  if (!attack) {
    return null;
  }
  const text = attackText || `${attack.name || ""} ${attack.flag || ""} ${attack.bonusText || ""} ${attack.detail || ""}`;
  return {
    attackText: text,
    attack,
    range: getAttackRangeInfo(text, attack)
  };
}

function getLiveCombatMonsters() {
  if (!isCombatActive()) {
    return [];
  }
  return ensureCombatState().monsterIds
    .map(getMonsterById)
    .filter(Boolean);
}

function getSingleCombatMonsterTarget() {
  const monsters = getLiveCombatMonsters();
  return monsters.length === 1 ? monsters[0] : null;
}

function getWeaponOutOfRangeMessage(weaponName) {
  return `Out of range with ${String(weaponName || "weapon").toLowerCase()}.`;
}

function consumeCharacterCombatAction(character, { teleport = false, clawAttack = false } = {}) {
  character = inventoryController(character);
  if (isTied(character) && !teleport) { setStatus('Escape or break the rope before acting.'); return false; }
  if(state.encounterPrompt){setStatus('Resolve the monster reaction first.');return false;}
  if (restInProgress(state)) { setStatus('Cancel rest before taking an action.'); return false; }
  if (character?.pendingSpell) {
    setStatus(pendingSpellMessage(character));
    return false;
  }
  if (!isCombatActive()) {
    return true;
  }
  if (!isCurrentCharacterTurn(character)) {
    setStatus("It is not that character's turn.");
    return false;
  }
  if (!clawAttack && hasAlterSelfFeature(character, 'claws') && remainingClawAttacks(state, character) === 1) {
    setStatus('Finish the second claw attack or end the turn before taking another action.'); return false;
  }
  if (state.combat.actionUsed) {
    setStatus(`${character.name || "Character"} has already acted this turn.`);
    return false;
  }
  state.combat.actionUsed = true;
  return true;
}

function getVisibleMonsterAtTile(x, y) {
  return getLiveMonsters().find(monster => sameRoute(state, monster, state.player) && Number(monster.x) === x && Number(monster.y) === y && isMonsterCurrentlyVisible(state, monster)) || null;
}

function consumeWeaponCombatAction(character, attack) {
  const claws = attack?.name === 'Claws' && hasAlterSelfFeature(character, 'claws');
  if (!consumeCharacterCombatAction(character, { clawAttack: claws })) return false;
  if (claws) { const spent = spendClawAttack(state, character); if (isCombatActive()) state.combat.actionUsed = spent.actionComplete; }
  return true;
}

function getAlertingMonstersFromAttack(originMonster) {
  if (!originMonster) {
    return [];
  }
  return getLiveMonsters().filter((monster) => (
    creatureSight(originMonster, monster)
  ));
}

function resolveCharacterAttackAgainstMonster(character, combatAttack, monster, { blindSquare = false } = {}) {
  if (monster && !sameRoute(state, character, monster)) throw new Error('That target is in a different passage.');
  if (isIncorporeal(character)) throw new Error('Become corporeal before attacking.');
  const partyTarget = state.characters.includes(monster);
  if (partyTarget && monster.id === character?.id) throw new Error('You cannot attack yourself.');
  if (!isAttackEquipped(character, combatAttack?.attack)) return { message: "Equip that weapon before attacking." };
  if (isSharedRoom()) {
    const attackIndex = getRenderableAttacks(character).findIndex((text) => parseAttackText(text)?.name === combatAttack?.attack?.name);
    sendSharedCommand("attack", { monster_id: partyTarget ? null : monster?.id, target_id: partyTarget ? monster.id : null, confirmed: partyTarget, attack_index: Math.max(0, attackIndex) }, character);
    return { message: "Attack submitted." };
  }
  if (!character) {
    const message = "Select a character before attacking a monster.";
    setStatus(message);
    return { message };
  }
  if (!isCharacterAbleToAct(character)) {
    const message = `${character.name || "Character"} can't attack right now.`;
    setStatus(message);
    return { message };
  }
  if (isCombatActive() && !isCurrentCharacterTurn(character)) {
    const message = "It is not that character's turn.";
    setStatus(message);
    return { message };
  }
  if (!combatAttack) {
    const message = `${character.name || "Character"} has no listed attack.`;
    setStatus(message);
    return { message };
  }
  const distance = getMonsterDistanceToCharacter(monster, character);
  if (combatAttack.attack.name === "Unarmed") {
    combatAttack.attack = rollUnarmedAttack(abilityScoreModifier(character.stats?.STR));
  }
  const weaponName = combatAttack.attack.name || "weapon";
  if (combatAttack.range.maxRange <= 1 && !transformationMovementRules(state, character).canMeleeAttack) return { message: 'You cannot make melee attacks while levitating.' };
  if (combatAttack.range.maxRange <= 1 && transformationMovementRules(state, monster).levitating) return { message: `${monster.name} levitates beyond melee reach.` };
  if (distance < 1 || !canTargetAtRange(state, character, monster, combatAttack.range.maxRange, { directAttack: !blindSquare, requireLight: !blindSquare && !partyTarget })) {
    const message = getWeaponOutOfRangeMessage(weaponName);
    setStatus(message);
    return { message };
  }
  const claws = combatAttack.attack.name === 'Claws' && hasAlterSelfFeature(character, 'claws');
  if (!consumeWeaponCombatAction(character, combatAttack.attack)) return { message: ui.statusText.textContent || 'Action unavailable.' };
  if (!SERVER_RUNTIME) targetingMode = null;

  const wasStealthed = isStealthed(character);
  const advantageReason = unawareReason(character, monster, state);
  const backstab = advantageReason ? getBackstabMultiplier(character) : 0;
  const surprisedMimic=concealedMimic(monster);
  if(surprisedMimic)monster.disguiseRevealed=true;
  const wardDisadvantage = protectionDisadvantage(state, character) || (isInvisible(monster) && !character.magicDetectedIds?.includes(monster.id)) ||
    !isDarkvisionCharacter(character) && (blindSquare || !isTileIlluminated(state, monster.x, monster.y, monster));
  if (blindSquare) markMonsterCorrectlyGuessed(monster);
  const item = character.gear[getAttackGearIndex(character, combatAttack.attack)];
  const ammoType = /crossbow/i.test(weaponName) ? 'bolts' : /(?:short|long)bow/i.test(weaponName) ? 'arrows' : '';
  const ammo = ammoType ? character.gear.find(item => getGearAmmoType(item) === ammoType && getGearUnits(item) > 0) : null;
  const knownMagic = revealedMagicBonus(item) + revealedMagicBonus(ammo);
  const hiddenMagic = magicBonus(item) - revealedMagicBonus(item) + magicBonus(ammo) - revealedMagicBonus(ammo);
  const thoughts = detectThoughtsModifiers(state, character, monster);
  const extraBonus = magicBonus(item) - revealedMagicBonus(item) + magicBonus(ammo) + thoughts.attack;
  const roll = rollCheck((combatAttack.attack.bonus || 0) + extraBonus, conditionAttackMode(monster, {
    advantage: Boolean(advantageReason), disadvantage: wardDisadvantage, melee: combatAttack.range.maxRange <= 1 || !ammoType && distance <= 1, close: distance <= 1, state }));
  if (ammo) {
    const remaining = getGearUnits(ammo) - 1;
    setGearItemUnits(ammo, remaining);
    if (remaining <= 0) character.gear.splice(character.gear.indexOf(ammo), 1);
    updateCharacterAmmoFromGearItem(character, ammo);
    character.raw.gear = structuredClone(character.gear);
  }
  revealAfterOffense(character);
  const ac = partyTarget ? Number(monster.armorClass) : getMonsterAc(monster);
  const hit = roll.total >= ac;
  const luck = beginLuckEvent(state, { kind: 'party-attack', actor: luckActorRef(character), target: luckActorRef(monster), roll, dc: ac,
    context: { weapon: weaponName, expression: addDamageBonus(getAttackDamageExpression(combatAttack.attack), extraBonus - thoughts.attack + thoughts.damage), backstab: backstab || 1,
      paralyzed: Boolean(monster.conditions?.paralyzed), elementalDice: item?.magic?.elementDice || null, element: item?.magic?.element || null } });
  const parts = [];
  let rolledDamage = null;
  let damageRoll = null;
  let defeated = false;
  const mirror = hit && interceptMirrorImageHit(state, monster);
  if (mirror?.intercepted) parts.push('destroys a mirror image');
  else if (hit) {
    const expression = addDamageBonus(getAttackDamageExpression(combatAttack.attack), extraBonus - thoughts.attack + thoughts.damage);
    if (expression) {
      const diceMultiplier = (backstab || 1) * (monster.conditions?.paralyzed ? 2 : 1);
      const damage = rollDamageExpression(diceMultiplier > 1 ? multiplyDamageDice(expression, diceMultiplier) : expression);
      if (item?.magic?.elementDice) {
        const elemental = rollDamageExpression(item.magic.elementDice);
        damage.total += elemental.total; damage.subtotal += elemental.total;
        damage.terms.push(...elemental.terms.map(term => ({ ...term, element: item.magic.element })));
      }
      if (giantStrengthActive(character) && (combatAttack.range.maxRange === 1 || (!ammoType && distance <= 1))) { damage.total *= 2; damage.multiplier *= 2; }
      damage.total *= attackDamageMultiplier(monster); damage.multiplier *= attackDamageMultiplier(monster);
      const resistance = elementalDamage(monster, damage.total, item?.magic?.element || '');
      if (resistance.resistance) { damage.unresistedTotal = damage.total; damage.resistance = resistance.resistance; damage.total = resistance.total; }
      rolledDamage = damage.total;
      damageRoll = damage;
      if (partyTarget) setCharacterHp(monster, Number(monster.hp) - damage.total, { sourceId: character.id });
      else { monster.hp = Math.max(0, (Number.parseInt(monster.hp, 10) || 0) - damage.total); if (damage.total > 0) wakeCreature(monster, state); }
      if (/fire|flame|burn/i.test(item?.magic?.element || '')) {
        igniteWebsAt(state, monster);
        for (const target of state.entities.filter(entity => entity.type === 'monster' && entity.id !== monster.id && !entity.defeated && entity.hp <= 0)) defeatMonster(state, target);
      }
      state.lastDamageSourceId=character.id;
      parts.push(`hit for ${damage.total} damage`);
      applyDamageResultToPanel(damage, `${character.name} ${weaponName}`, { recordHistory: false });
    } else {
      parts.push("hit");
    }
    if (!partyTarget && (Number.parseInt(monster.hp, 10) || 0) <= 0) {
      const result = defeatMonster(state, monster);
      defeated = true;
      parts.push(result.message);
    }
  } else {
    parts.push("miss");
    showCheckResult(roll, "Attack", {
      headline: `Attack ${roll.total}`,
      message: parts.join(": "), recordHistory: false
    });
  }

  markUserActivity();
  markRunDirty();
  const alerting = partyTarget ? [] : defeated ? getAlertingMonstersFromAttack(monster).filter((candidate) => candidate.id !== monster.id) : getAlertingMonstersFromAttack(monster);
  let preserveCombatStatus = false;
  if (alerting.length && !isCombatActive()) {
    character.openingSpellActionSpent = true;
    const started = beginCombat(`Combat begins after ${character.name}'s attack.`, { initiator: wasStealthed||surprisedMimic ? character : null,
      forcedSurprisedIds:surprisedMimic?[monster.id]:[],
      extraMonsterIds: alerting.map(monster => monster.id) });
    preserveCombatStatus = started && !isCombatActive();
  } else if (isCombatActive()) {
    detectAdditionalCombatMonsters();
    preserveCombatStatus = checkCombatEnd();
  }
  const ability = claws ? 'INT' : getWeaponProfileFromText(weaponName)?.ability || 'STR';
  const message = attackNarrative({ character, monster: { ...monster, ac, partyMember: partyTarget }, weapon: weaponName, roll, ability,
    abilityModifier: abilityScoreModifier(character.stats?.[ability]), hit, damage: rolledDamage, magic: knownMagic, hiddenMagic, backstab: Boolean(backstab), advantageReason }) + (mirror?.intercepted ? ' A mirror image is destroyed.' : '');
  pushDiceHistory('Attack', message, character.id, attackRollSegments({ character, monster: { ...monster, partyMember: partyTarget }, weapon: weaponName, roll, ability,
    abilityModifier: abilityScoreModifier(character.stats?.[ability]), hit, damage: rolledDamage, damageRoll, magic: knownMagic, hiddenMagic, backstab: Boolean(backstab), advantageReason }));
  dismissedTurnRadius = targetingTurnKey();
  if (!preserveCombatStatus) {
    setStatus(message);
  }
  pushCombatLog(message);
  finishLuckEvent(state, luck, { succeeded: hit });
  scheduleAutoEndTurnIfNeeded();
  return { message };
}

function attackClickedMonster(monster) {
  const character = getActiveCharacter(state);
  return resolveCharacterAttackAgainstMonster(character, targetingMode?.kind === 'weapon' && targetingMode.characterId === character?.id
    ? getCombatAttackFromParsedAttack(targetingMode.attack) : getFirstCombatAttack(character), monster);
}

function selectedWeaponAttack(character, index = null) {
  const attacks = getRenderableAttacks(character);
  if (index != null) {
    const parsed = Number.isInteger(index) ? parseAttackText(attacks[index]) : null;
    if (!parsed || !isAttackEquipped(character, parsed)) throw new Error('Choose an equipped attack.');
    return getCombatAttackFromParsedAttack(parsed, attacks[index]);
  }
  return targetingMode?.kind === 'weapon' ? getCombatAttackFromParsedAttack(targetingMode.attack) : getFirstCombatAttack(character);
}

function attackEmptyTile(character, x, y, index = null) {
  const attack = selectedWeaponAttack(character, index);
  if (!attack || !Number.isInteger(x) || !Number.isInteger(y) || !canTargetAtRange(state, character, { x, y, routeId: routeOf(state, character) }, attack.range.maxRange, { requireLight: false })) throw new Error('That square is outside attack range.');
  if (state.characters.some(member => member.x === x && member.y === y && sameRoute(state, member, character)) || getDoorAt(state, x, y)) throw new Error('Choose an empty square.');
  const attackIndex = getRenderableAttacks(character).findIndex(text => parseAttackText(text)?.name === attack.attack.name);
  if (sendSharedCommand('attack_empty', { x, y, attack_index: attackIndex }, character)) return;
  const hidden = getLiveMonsters().find(monster => monster.x === x && monster.y === y && sameRoute(state, character, monster));
  if (hidden) return resolveCharacterAttackAgainstMonster(character, attack, hidden, { blindSquare: !isMonsterCurrentlyVisible(state, hidden) || concealedMimic(hidden) });
  if (!consumeWeaponCombatAction(character, attack.attack)) { if (SERVER_RUNTIME) throw new Error('Action unavailable.'); return; }
  if (attack.attack.name === 'Unarmed') attack.attack = rollUnarmedAttack(abilityScoreModifier(character.stats?.STR));
  const item = character.gear[getAttackGearIndex(character, attack.attack)];
  const ammoType = /crossbow/i.test(attack.attack.name) ? 'bolts' : /(?:short|long)bow/i.test(attack.attack.name) ? 'arrows' : '';
  const ammo = ammoType ? character.gear.find(item => getGearAmmoType(item) === ammoType && getGearUnits(item) > 0) : null;
  const hiddenMagic = magicBonus(item) - revealedMagicBonus(item) + magicBonus(ammo) - revealedMagicBonus(ammo);
  const roll = rollCheck((attack.attack.bonus || 0) + magicBonus(item) - revealedMagicBonus(item) + magicBonus(ammo), { disadvantage: protectionDisadvantage(state, character) });
  if (ammo) {
    setGearItemUnits(ammo, getGearUnits(ammo) - 1);
    if (getGearUnits(ammo) <= 0) character.gear.splice(character.gear.indexOf(ammo), 1);
    updateCharacterAmmoFromGearItem(character, ammo); character.raw.gear = structuredClone(character.gear);
  }
  const ability = getWeaponProfileFromText(attack.attack.name)?.ability || 'STR';
  const feature = state.entities.find(entity => entity.type === 'feature' && !entity.collected && !entity.destroyed &&
    !/stairs|pit|spell-light/.test(entity.doorKind || entity.subtype || '') && entity.x === x && entity.y === y && sameRoute(state, character, entity));
  const hit = Boolean(feature && (roll.roll === 20 || roll.roll !== 1 && roll.total >= 10));
  const luck = beginLuckEvent(state, { kind: 'party-attack', actor: luckActorRef(character), target: feature ? luckActorRef(feature) : null, roll, dc: 10,
    context: { weapon: attack.attack.name, expression: getAttackDamageExpression(attack.attack), feature: Boolean(feature) } });
  const damage = hit ? rollDamageExpression(roll.roll === 20 ? multiplyDamageDice(getAttackDamageExpression(attack.attack), 2) : getAttackDamageExpression(attack.attack)) : null;
  if (feature) {
    feature.hp = Math.max(0, (Number.isFinite(feature.hp) ? feature.hp : 10) - (damage?.total || 0));
    if (feature.hp === 0) { feature.destroyed = true; feature.visible = false; feature.collected = true; }
  }
  const parts = attackRollSegments({ character, monster: { name: feature?.name || 'nothing' }, weapon: attack.attack.name, roll, ability,
    abilityModifier: abilityScoreModifier(character.stats?.[ability]), hit, damage: damage?.total, damageRoll: damage,
    magic: revealedMagicBonus(item) + revealedMagicBonus(ammo), hiddenMagic });
  const message = parts.map(part => part.text).join('');
  pushDiceHistory('Attack', message, character.id, parts); setStatus(message); revealAfterOffense(character);
  finishLuckEvent(state, luck, { succeeded: hit });
  targetingMode = null; dismissedTurnRadius = targetingTurnKey(); markRunDirty(); updatePanels(); render(); scheduleAutoEndTurnIfNeeded();
}

function performMapAttack(x, y) {
  const actor = getActiveCharacter(state);
  if (!actor || !canControlCharacter(actor)) return;
  try {
    const victim = getCharacterAtTile(x, y);
    if (victim) { if (victim.id !== actor.id) confirmPartyAttack(actor, victim); return; }
    const door = getDoorAt(state, x, y);
    if (door) attackDoor(actor, door.id);
    else attackEmptyTile(actor, x, y);
    render(); updatePanels(); updateMonsterHoverCursor();
  } catch (error) { setStatus(error.message); }
}

function attackDoor(character, doorId, index = null) {
  const door = state.entities.find(entity => entity.id === doorId && entity.subtype === 'door');
  const attack = selectedWeaponAttack(character, index);
  const profile = getWeaponProfileFromText(attack?.attack?.name);
  const melee = attack && (profile ? !profile.ammo : attack.range.hasClose);
  if (!door || !melee || !canTargetAtRange(state, character, door, 1, { requireLight: false })) throw new Error('Smash a nearby door with a melee weapon.');
  const attackIndex = getRenderableAttacks(character).findIndex(text => parseAttackText(text)?.name === attack.attack.name);
  if (sendSharedCommand('attack_door', { entity_id: doorId, attack_index: attackIndex }, character)) return;
  if (!consumeWeaponCombatAction(character, attack.attack)) { if (SERVER_RUNTIME) throw new Error('Action unavailable.'); return; }
  const roll = rollCheck(attack.attack.bonus || 0, { disadvantage: /dagger/i.test(attack.attack.name) || protectionDisadvantage(state, character) });
  const hit = roll.roll === 20 || roll.roll !== 1 && roll.total >= 10;
  const expression = getAttackDamageExpression(attack.attack);
  const luck = beginLuckEvent(state, { kind: 'party-attack', actor: luckActorRef(character), target: luckActorRef(door), roll, dc: 10,
    context: { weapon: attack.attack.name, expression, feature: true, door: true } });
  const damage = hit ? rollDamageExpression(roll.roll === 20 ? multiplyDamageDice(expression, 2) : expression) : null;
  door.hp = Math.max(0, (Number.isFinite(door.hp) ? door.hp : 15) - (damage?.total || 0));
  if (hit && door.hp === 0) { setDoorState(door, 'gone'); delete door.holdPortal; }
  const parts = attackRollSegments({ character, monster: { name: 'door' }, weapon: attack.attack.name, roll,
    ability: 'STR', abilityModifier: abilityScoreModifier(character.stats?.STR), hit, damage: damage?.total, damageRoll: damage });
  const message = parts.map(part => part.text).join('') + (door.hp === 0 ? ' The door is destroyed.' : ` Door HP ${door.hp}/15.`);
  revealAfterOffense(character); setStatus(message); pushDiceHistory('Attack', message, character.id, parts);
  finishLuckEvent(state, luck, { succeeded: hit });
  targetingMode = null; dismissedTurnRadius = targetingTurnKey(); markRunDirty(); recomputeVisibility(state); updatePanels(); render(); scheduleAutoEndTurnIfNeeded();
}

let pendingPartyAttack = null;
function confirmPartyAttack(actor, target) {
  if (actor.id === target.id || isFloatingDisc(target)) return;
  pendingPartyAttack = { actorId: actor.id, targetId: target.id, attack: selectedWeaponAttack(actor), turnKey: targetingTurnKey() };
  document.getElementById('party-attack-title').textContent = `Seriously attack ${target.name}?`;
  document.getElementById('party-attack-modal').hidden = false;
}

function applyDamageResultToPanel(roll, sourceLabel, options = {}) {
  if (SERVER_RUNTIME) {
    lastDamageRoll = { ...roll, sourceLabel };
    if (options.recordHistory !== false) pushDiceHistory(`${roll.total} Damage`, `${sourceLabel || 'Damage'} ${roll.expression}`, null, damageRollSegments(sourceLabel, roll));
    return;
  }
  if (!ui.damageResult || !roll) {
    return;
  }
  ui.damageResult.textContent = `${roll.total} Damage`;
  ui.damageContext.textContent = sourceLabel || roll.expression || "Damage";
  lastDamageRoll = {
    ...roll,
    sourceLabel,
    display: roll.expression
  };
  if (ui.damageExpandBtn) {
    ui.damageExpandBtn.hidden = !(roll.terms?.length || roll.rolls?.length);
  }
  renderDamageDetail(lastDamageRoll);
  if (options.recordHistory !== false) pushDiceHistory(`${roll.total} Damage`, `${sourceLabel || "Damage"} ${roll.expression}`, null, damageRollSegments(sourceLabel, roll));
  setDamageDetailVisibility(false);
}

function prepareEncounterState() {
  cleanupWizardTierTwoFocus(state); syncTransformationEffects(state); syncAreaSpellConditions(state);
  for (const character of [...state.characters]) if (character.companion?.charm?.brokenByParty) endCharacterCharm(character, true);
  restoreMonsterSpellStats(state,shadowdarkContent?.monsters);
  initializeMorale(state); initializeDisguises(state);
  updateMonsterStealth(state,{canSee:creatureSight});
  refreshMagicDetection(state);
  for (const character of [...state.characters]) if (character.detectedDoppelganger && character.companion?.kind === 'doppelganger') {
    const monster = { ...structuredClone(character.companion.source), id: character.companion.sourceMonsterId,
      x: character.x, y: character.y, routeId: routeOf(state, character), roomId: character.roomId, hp: character.hp, carriedGear: character.gear,
      disguiseRevealed: true, impersonatedCharacter: null, hostile: true, attitude: 'hostile', attitudeChecked: true };
    state.entities.push(monster);
    state.characters = state.characters.filter(member => member.id !== character.id);
    setStatus('Detect Magic reveals a Doppelganger in the party!');
  }
}

function joinFriendlyMonster(monster,speaker=null,kind='friendly') {
  if(!floatingDiscSlotsAvailable(state)) {
    if (kind === 'charmed') return;
    dropCompanionGear(state,buildMonsterCompanion(monster));
    monster.departing=true;
    setStatus(`The friendly ${monster.name} leaves with a tearful goodbye.`);
    return;
  }
  const controller=speaker||state.characters.find(character=>!isFloatingDisc(character)&&!isCharacterDead(character));
  const companion=buildMonsterCompanion(monster,{controllerId:controller?.id,kind});
  if (kind === 'charmed') companion.companion.charm = structuredClone(monster.charm);
  state.entities=state.entities.filter(entity=>entity.id!==monster.id);
  state.characters.push(companion);normalizeCharacterState(state);ensureCharacterPresentation();
  queueCharactersForNextCombatRound([companion]);
  syncAllCharacterEquipmentDerivedStats();markRunDirty();
}

function applyMonsterReaction(monster,{talk=false,speaker=null}={}) {
  const result=resolveReaction(state,monster,{talk,speaker});
  pushDiceHistory('Reaction',result.message,speaker?.id);setStatus(result.message);
  if(result.attitude==='friendly')joinFriendlyMonster(monster,speaker);
  if(result.attitude==='hostile')result.combatStarted=beginCombat(result.message,{extraMonsterIds:[monster.id]});
  markRunDirty();return result;
}

function removeCharmedMonsterFromCombat(monsterId) {
  const combat = ensureCombatState();
  const removedBefore = combat.turnOrder.slice(0, combat.turnIndex).filter(entry => entry.type === 'monster' && entry.id === monsterId).length;
  combat.monsterIds = combat.monsterIds.filter(id => id !== monsterId);
  combat.turnOrder = combat.turnOrder.filter(entry => entry.type !== 'monster' || entry.id !== monsterId);
  combat.turnIndex = Math.max(0, combat.turnIndex - removedBefore);
}

function endCharacterCharm(character, harmed = false) {
  if (character.companion?.kind !== 'charmed') return;
  const monster = { ...structuredClone(character.companion.source), id: character.companion.sourceMonsterId,
    x: character.x, y: character.y, routeId: routeOf(state, character), roomId: character.roomId, hp: character.hp, maxHp: character.maxHitPoints,
    carriedGear: structuredClone(character.gear), defeated: character.dead || character.slain,
    hostile: harmed, attitude: harmed ? 'hostile' : 'suspicious', attitudeChecked: true };
  delete monster.charm;
  state.characters = state.characters.filter(member => member.id !== character.id);
  state.entities.push(monster);
  if (Number(monster.hp) <= 0) defeatMonster(state, monster);
  if (state.activeCharacterId === character.id) setActiveCharacter(state, state.characters.find(isLivingCharacter)?.id);
  setStatus(`${monster.name}'s charm ends${harmed ? ' after being harmed by the party' : ''}.`);
  if (harmed && !monster.defeated) addMonstersToCombat([monster], 'The harmed humanoid is no longer charmed.');
}

function advanceCharmTime(milliseconds) {
  for (const character of [...state.characters]) if (character.companion?.charm) {
    character.companion.charm.remainingMs -= milliseconds;
    if (character.companion.charm.remainingMs <= 0) endCharacterCharm(character);
  }
  for (const monster of state.entities) if (monster.charm) {
    monster.charm.remainingMs -= milliseconds;
    if (monster.charm.remainingMs <= 0) { delete monster.charm; monster.attitude = 'suspicious'; }
  }
}

function answerReaction(talk,command={}) {
  if(isSharedRoom()) {
    const speaker=state.characters.find(character=>character.id===state.encounterPrompt?.speakerId);
    void executeSharedCommand({type:'reaction',character_id:speaker?.id,talk}).catch(()=>{});return;
  }
  const prompt=state.encounterPrompt,monster=getMonsterById(prompt?.monsterId);
  if(!prompt||!monster) {state.encounterPrompt=null;return;}
  const speaker=state.characters.find(character=>character.id===prompt.speakerId);
  state.encounterPrompt=null;ensureTimers(state).lastTickAt=Date.now();
  applyMonsterReaction(monster,{talk,speaker});processMonsterSightings();
  updatePanels();render();
}

function syncEncounterPromptUi() {
  if(SERVER_RUNTIME||!state)return;
  const modal=document.getElementById('reaction-modal'),prompt=state.encounterPrompt;
  modal.hidden=!prompt;
  if(!prompt)return;
  const speaker=state.characters.find(character=>character.id===prompt.speakerId),monster=getMonsterById(prompt.monsterId);
  document.getElementById('reaction-question').textContent=`Try talking to the ${displayMonsterName(monster||{}).toLowerCase()}?`;
  const color=getCharacterColorValue(speaker),card=modal.querySelector('.modal-card');
  card.style.borderColor=color;card.style.background=mixTokenColor(color,'#ffffff',.1);card.style.color='#111111';
  document.getElementById('reaction-speaker').textContent=speaker?.name||'';
  document.getElementById('reaction-speaker').style.color=color;
  const allowed=!isSharedRoom()||multiplayerSession.role==='host'||ownsCharacter(speaker);
  for(const button of modal.querySelectorAll('button'))button.disabled=!allowed||sharedCommandPending>0;
}

function startDisguiseAmbush(monster,target) {
  if(isDoppelganger(monster)) {
    monster.impersonatedCharacter=structuredClone({...target,colorValue:getCharacterColorValue(target)});
    monster.impersonationStarted=true;monster.emulatedId=target.id;
  }
  if(concealedMimic(monster))monster.disguiseRevealed=true;
  monster.hostile=true;monster.attitude='hostile';monster.attitudeChecked=true;monster.ambushAttack=true;
  const forced=state.characters.filter(character=>!neverSurprised(character)).map(character=>character.id);
  forced.push(...getLiveMonsters().filter(other=>other.id!==monster.id&&!neverSurprised(other)).map(other=>other.id));
  state.encounterPrompt=null;
  return beginCombat(`${displayMonsterName(monster)} ambushes the party!`,{initiator:monster,forcedSurprisedIds:forced,extraMonsterIds:[monster.id]});
}

function checkDoppelApproach() {
  for(const monster of getLiveMonsters().filter(monster=>isDoppelganger(monster)&&!monster.impersonationStarted&&!monster.disguiseRevealed)) {
    const target=state.characters.find(character=>!isFloatingDisc(character)&&!isCharacterDead(character)&&!isStealthed(character)&&
      Math.hypot(character.x-monster.x,character.y-monster.y)<=3&&creatureSight(monster,character));
    if(target){startDisguiseAmbush(monster,target);return true;}
  }
  return false;
}

function settleCompanionsAfterCombat() {
  for(const character of [...state.characters]) if(character.companion?.kind==='friendly'&&character.companion.departurePending&&isCharacterAbleToAct(character)) {
    const message=companionLeaves(state,character);setStatus(message);pushDiceHistory('Departure',message);
  }
  for(const monster of [...getLiveMonsters()]) if(isDoppelganger(monster)&&monster.impersonatedCharacter) {
    const victim=state.characters.find(character=>character.id===monster.emulatedId);
    if(!victim||!isCharacterDead(victim)||!state.characters.some(character=>character.id!==victim.id&&!isCharacterDead(character)))continue;
    const hadRoom=floatingDiscSlotsAvailable(state)>0;
    const selected=state.activeCharacterId===victim.id;
    archiveSlainCharacter(state,victim);
    if(hadRoom){victim.gear=[];victim.gold=0;victim.silver=0;victim.copper=0;victim.raw={...(victim.raw||{}),gear:[],gold:0,silver:0,copper:0};state.characters.push(victim);}
    const character=buildMonsterCompanion(monster,{kind:'doppelganger',controllerId:victim.id,impersonated:monster.impersonatedCharacter});
    if(monster.carriedGear?.length)character.gear=structuredClone(monster.carriedGear);
    state.entities=state.entities.filter(entity=>entity.id!==monster.id);state.characters.push(character);
    normalizeCharacterState(state);ensureCharacterPresentation();if(selected)setActiveCharacter(state,character.id);
  }
}

function betrayDoppelganger(character) {
  const data=character.companion;
  const monster=structuredClone(data.source);
  Object.assign(monster,{id:data.sourceMonsterId,type:'monster',hp:character.hp,maxHp:character.maxHitPoints,
    x:character.x,y:character.y,routeId:routeOf(state,character),roomId:character.roomId,impersonationStarted:false,impersonatedCharacter:null,
    disguiseRevealed:false,carriedGear:structuredClone(character.gear)});
  state.characters=state.characters.filter(member=>member.id!==character.id);
  state.entities=state.entities.filter(entity=>entity.id!==monster.id);state.entities.push(monster);
  const target=state.characters.filter(member=>!isFloatingDisc(member)&&!isCharacterDead(member)).sort((a,b)=>
    Math.hypot(a.x-monster.x,a.y-monster.y)-Math.hypot(b.x-monster.x,b.y-monster.y))[0];
  if(target)startDisguiseAmbush(monster,target);
  markRunDirty();return true;
}

function triggerPartyDoppelgangers() {
  if(isCombatActive())return false;
  const impostor=state.characters.find(character=>character.companion?.kind==='doppelganger'&&isCharacterAbleToAct(character));
  return impostor?betrayDoppelganger(impostor):false;
}

function monsterCanPlanStep(monster, fromX, fromY, x, y, { forceDoors = true, routeId = routeOf(state, monster), ignoreArmorLight = false } = {}) {
  const next = routeStep(state, { x: fromX, y: fromY, routeId }, { x, y }, { phase: isIncorporeal(monster) });
  if (!next || isMonsterMoveOccupied(monster, x, y, next.routeId)) return false;
  if (!ignoreArmorLight && !animatedArmorCanEnter(state, monster, next, { isIlluminated: point => isTileIlluminated(state, point.x, point.y, point) })) return false;
  if (isIncorporeal(monster)) return phaseStepAllowed(state, fromX, fromY, x, y);
  const door = getDoorBetween(state, fromX, fromY, x, y) || getDoorAt(state, x, y);
  if (door && !['open', 'gone'].includes(door.doorState) &&
      (door.secret && !door.secretFound && !door.revealed || !forceDoors && (portalHeld(door) || door.doorState === 'locked'))) return false;
  return canMoveBetweenTiles(state, fromX, fromY, x, y, { ignoreClosedDoors: true, creature: monster, routeId }).ok;
}

function monsterFiringPosition(monster, target, range, movement, { preferRange = false, forceDoors = true } = {}) {
  if (getMonsterDistanceToCharacter(monster, target) > movement + Math.ceil(range)) return null;
  return planFiringPosition(state, monster, target, {
    movement, preferRange,
    canStep: (fromX, fromY, x, y, point) => monsterCanPlanStep(monster, fromX, fromY, x, y, { forceDoors, routeId: point?.routeId }),
    canAttackFrom: (x, y, point) => withinTargetRange({ x, y, routeId: point?.routeId }, target, range) &&
      (isIncorporeal(monster) || creatureSight({ ...monster, x, y, routeId: point?.routeId }, target)),
    stepCost: (x, y) => isIncorporeal(monster) ? 1 : movementStepCost(state, x, y),
    isHidden: (x, y, point) => !isTileVisible(state, x, y, point)
  });
}

function hiddenMonsterAttackPlan(monster) {
  if (!isStealthed(monster) || isSleeping(monster, state) || concealedMimic(monster) || isDoppelganger(monster) ||
      monster.curious || monster.departing || ['friendly', 'neutral', 'indifferent'].includes(monster.attitude)) return null;
  const target = state.characters.filter(character => isCharacterTargetableByMonster(character) && sameRoute(state, monster, character) &&
    Math.hypot(character.x - monster.x, character.y - monster.y) <= 14)
    .sort((a, b) => Math.hypot(a.x - monster.x, a.y - monster.y) - Math.hypot(b.x - monster.x, b.y - monster.y))[0];
  const preference = getMonsterAttackPreference(monster);
  const attack = preference.preferNear ? preference.bestNear : preference.bestClose;
  if (!target || !attack) return null;
  return { target, attack, preference, route: monsterFiringPosition(monster, target, attack.rangeInfo.maxRange,
    getMonsterMoveSquares(monster), { forceDoors: false }) };
}

function beginHiddenMonsterAmbush(monster, plan = hiddenMonsterAttackPlan(monster)) {
  if (!plan?.route) return false;
  monster.hostile = true; monster.attitude = 'hostile'; monster.attitudeChecked = true;
  monster.ambushAttack = true; monster.combatTargetId = plan.target.id;
  return beginCombat(`${monster.name} attacks from hiding!`, { initiator: monster, monsterAmbush: true, extraMonsterIds: [monster.id] });
}

function progressEncounterCreatures(milliseconds) {
  if(state.encounterPrompt)return false;
  let changed=false;
  for(const monster of state.entities)if(monster.curious) {
    monster.curious.remainingMs-=milliseconds;
    if(monster.curious.remainingMs<=0){delete monster.curious;monster.attitude='neutral';changed=true;}
  }
  if(isCombatActive())return changed;
  settleCompanionsAfterCombat();prepareEncounterState();
  if (updateAnimatedArmorDisguises(state, { hasLineOfSight: creatureSight }).length) changed = true;
  for(const monster of [...getLiveMonsters()]) {
    if (monster.wandering && concealedAnimatedArmor(monster)) {
      const retreat = planWanderingArmorRetreat(state, monster, {
        movement: Math.max(1, movementStepCost(state, monster.x, monster.y)), isIlluminated: point => isTileIlluminated(state, point.x, point.y, point), hasLineOfSight: creatureSight,
        stepCost: (x, y) => movementStepCost(state, x, y),
        canStep: (fromX, fromY, x, y, point) => monsterCanPlanStep(monster, fromX, fromY, x, y, { routeId: point.routeId, ignoreArmorLight: true })
      });
      if (retreat?.steps.length) { changed = moveMonsterPlannedStep(monster, retreat.steps[0]) || changed; recomputeVisibility(state); }
      continue;
    }
    if (shouldAnimatedArmorWait(state, monster, { isIlluminated: point => isTileIlluminated(state, point.x, point.y, point) })) continue;
    if(monster.departing) {
      if(!state.characters.some(character=>canCharacterSeeMonster(character,monster))) {state.entities=state.entities.filter(entity=>entity.id!==monster.id);changed=true;continue;}
      const target=state.characters.filter(character=>!isFloatingDisc(character)&&!isCharacterDead(character)).sort((a,b)=>Math.hypot(a.x-monster.x,a.y-monster.y)-Math.hypot(b.x-monster.x,b.y-monster.y))[0];
      if(target) {
        const queue=[{x:monster.x,y:monster.y,routeId:routeOf(state,monster),first:null}],seen=new Set([routeKey(queue[0])]);
        let exit=null;
        for(let index=0;index<queue.length;index++) {
          const point=queue[index];
          if(point.first&&!state.characters.some(character=>!isCharacterDead(character)&&isTileVisible(state,point.x,point.y,point)&&creatureSight(character,point))) {exit=point.first;break;}
          for(const [dx,dy]of[[0,-1],[1,0],[0,1],[-1,0],[1,-1],[1,1],[-1,1],[-1,-1]]) {
            const x=point.x+dx,y=point.y+dy,next=routeStep(state,point,{x,y});
            if(!next||seen.has(routeKey(next))||isMonsterMoveOccupied(monster,x,y,next.routeId)||!canMoveBetweenTiles(state,point.x,point.y,x,y,{creature:monster,routeId:point.routeId}).ok)continue;
            seen.add(routeKey(next));queue.push({...next,first:point.first||next});
          }
        }
        if(exit){monster.x=exit.x;monster.y=exit.y;monster.routeId=exit.routeId;monster.roomId=getTileAt(exit.x,exit.y)?.roomId;changed=true;}
      }
      continue;
    }
    if(monster.curious) {
      const target=state.characters.find(character=>character.id===monster.curious.targetId&&!isCharacterDead(character));
      if(target){const distance=getMonsterDistanceToCharacter(monster,target);if(distance!==5)changed=moveMonsterOneStep(monster,target,distance<5?'away':'toward')||changed;}
    }
    const ambush = hiddenMonsterAttackPlan(monster);
    if (ambush) {
      if (beginHiddenMonsterAmbush(monster, ambush)) { changed = true; break; }
      const step = findPursuitStep(state, monster, ambush.target, {
        canStep: (fromX, fromY, x, y, point) => monsterCanPlanStep(monster, fromX, fromY, x, y, { forceDoors: false, routeId: point.routeId }),
        canAttackFrom: (x, y, target, point) => withinTargetRange({ x, y }, ambush.target, ambush.attack.rangeInfo.maxRange) &&
          sameRoute(state, point, ambush.target) && (isIncorporeal(monster) || creatureSight(point, ambush.target)),
        maxNodes: 2048
      });
      if (step) {
        const door = getDoorBetween(state, monster.x, monster.y, step.x, step.y) || getDoorAt(state, step.x, step.y);
        if (!isIncorporeal(monster) && door && door.doorState === 'closed') setDoorState(door, 'open');
        monster.x = step.x; monster.y = step.y; monster.routeId = step.routeId; monster.roomId = getTileAt(step.x, step.y)?.roomId ?? null;
        changed = true; recomputeVisibility(state); updateMonsterStealth(state);
        if (beginHiddenMonsterAmbush(monster)) break;
      }
    }
  }
  return changed;
}

function processMonsterSightings() {
  if (!state || isCombatActive()) {
    return { combatStarted: false, combatEnded: false, messages: [] };
  }
  prepareEncounterState();
  updateAnimatedArmorDisguises(state, { hasLineOfSight: creatureSight });
  if(state.encounterPrompt)return {combatStarted:false,combatEnded:false,messages:[]};
  const messages = [];
  let combatStarted = false;
  for (const monster of getLiveMonsters()) {
    if (concealedAnimatedArmor(monster)) continue;
    if(concealedMimic(monster)||isDoppelganger(monster)&&!monster.disguiseRevealed)continue;
    if (isSleeping(monster, state)) continue;
    if (canPhase(monster) && !isIncorporeal(monster)) {
      const nearby = state.characters.find(character => isCharacterAbleToAct(character) && !isStealthed(character) && getMonsterDistanceToCharacter(monster, character) <= 12);
      if (nearby && sameRoute(state, monster, nearby) && !creatureSight(monster, nearby)) {
        monster.conditions ||= {}; monster.conditions.incorporeal = true;
      }
    }
    if (isStealthed(monster)) {
      if (beginHiddenMonsterAmbush(monster)) { combatStarted = true; break; }
      continue;
    }
    if(suspiciousProvoked(state,monster,{canSee:creatureSight})) {
      monster.hostile=true;monster.attitude='hostile';
      combatStarted=beginCombat(`${monster.name} becomes hostile.`,{extraMonsterIds:[monster.id]});break;
    }
    const knownHostile = monster.hostile || ['hostile','combat'].includes(monster.attitude);
    if (monster.attitudeChecked === true && !knownHostile) {
      continue;
    }
    const seen = (state.characters || []).some(character => !isStealthed(character)&&canCharacterSeeMonster(character,monster));
    const darkSight = (knownHostile || automaticallyHostile(monster)) && state.characters.some(character =>
      getMonsterDistanceToCharacter(monster, character) <= 12 && canMonsterSeeCharacter(monster, character));
    if (!seen && !darkSight) {
      continue;
    }
    if(knownHostile || automaticallyHostile(monster)) {
      monster.hostile=true;monster.attitude='hostile';monster.attitudeChecked=true;
      combatStarted=beginCombat(`${monster.name} attacks.`,{extraMonsterIds:[monster.id]});break;
    }
    const speaker=reactionSpeaker(state,monster);
    if(speaker) {state.encounterPrompt={monsterId:monster.id,speakerId:speaker.id};ensureTimers(state).lastTickAt=Date.now();syncEncounterPromptUi();break;}
    const result = applyMonsterReaction(monster);
    messages.push(result.message);
    if (result.combatStarted) {
      combatStarted = true;
      break;
    }
  }
  if (messages.length) {
    if (!combatStarted) {
      setStatus(messages[messages.length - 1]);
    }
    markRunDirty();
  }
  return { combatStarted, combatEnded: false, messages };
}

function processMonsterVisibilityChange() {
  if (isSharedRoom()) return null;
  if (!state) {
    return { combatStarted: false, combatEnded: false, messages: [] };
  }
  prepareEncounterState();
  if(state.pendingAmbush) {
    const pending=state.pendingAmbush;state.pendingAmbush=null;
    const monster=getMonsterById(pending.monsterId),target=state.characters.find(character=>character.id===pending.targetId);
    if(monster&&target)startDisguiseAmbush(monster,target);
  }
  if(state.recentTreasurePickup) {
    const treasure=state.recentTreasurePickup;delete state.recentTreasurePickup;
    for(const monster of getLiveMonsters())if(suspiciousProvoked(state,monster,{treasure,actorId:treasure.characterId,
      canSee:creatureSight})) {
      monster.attitude='hostile';monster.hostile=true;beginCombat(`${monster.name} attacks over the stolen treasure.`,{extraMonsterIds:[monster.id]});break;
    }
  }
  if(!isCombatActive())checkDoppelApproach();
  if (isCombatActive()) {
    detectAdditionalCombatMonsters();
    return {
      combatStarted: false,
      combatEnded: checkCombatEnd(),
      messages: []
    };
  }
  return processMonsterSightings();
}

function removeMonsterPeacefully(monster) {
  const loot = addMonsterLootDrop(state, monster, {
    force: true,
    description: "Treasure left behind by a monster that departed peacefully."
  });
  const index = state.entities.findIndex((entity) => entity.id === monster.id);
  if (index !== -1) {
    state.entities.splice(index, 1);
  } else {
    monster.leftPeacefully = true;
    monster.visible = false;
  }
  return loot;
}

function persuadeMonster(monster) {
  if (sendSharedCommand("persuade", { monster_id: monster?.id })) return;
  const character = getActiveCharacter(state);
  if (!character) {
    setStatus("Select a character to persuade the monster.");
    return;
  }
  const dc = getMonsterLevel(monster) + 5 + getMonsterTagModifier(monster);
  const check = rollCheck(abilityScoreModifier(character?.stats?.CHA));
  const success = check.total >= dc;
  let message = `Persuade ${check.total} vs DC ${dc}: ${monster.name || "Monster"} remains indifferent.`;
  if (success) {
    const loot = removeMonsterPeacefully(monster);
    message = `${monster.name || "Monster"} leaves peacefully.${loot ? ` ${loot.name} is left behind.` : ""}`;
  }
  markUserActivity();
  markRunDirty();
  setStatus(message);
  showCheckResult(check, "Persuade", {
    headline: `Persuade ${check.total}`,
    message
  });
  render();
  updatePanels();
}

function attackIndifferentMonster(monster) {
  monster.attitude = "combat";
  monster.attitudeChecked = true;
  beginCombat(`${monster.name || "Monster"} is attacked. Combat begins.`);
  markUserActivity();
  markRunDirty();
  render();
  updatePanels();
}

function getMonsterAttackOptions(monster) {
  const value = String(monster?.attack || "").trim();
  if (!value) {
    return [];
  }
  return value
    .split(/\s+\b(?:or|and)\b\s+/i)
    .map((segment) => {
      const attack = parseMonsterAttackSegment(segment);
      if (!attack) {
        return null;
      }
      const expression = getAttackDamageExpression(attack);
      return {
        ...attack,
        segment,
        damageExpression: expression,
        averageDamage: getAverageDamage(expression),
        rangeInfo: getAttackRangeInfo(segment, attack)
      };
    })
    .filter(Boolean).filter(attack => !(monster.stolenGearNames || []).includes(String(attack.name).toLowerCase()) && !silenceBlocksAction(state, monster, { attack: attack.segment }));
}

function getMonsterAttackPreference(monster) {
  const attacks = getMonsterAttackOptions(monster);
  const closeAttacks = attacks.filter((attack) => attack.rangeInfo.hasClose || attack.rangeInfo.isCloseOnly);
  const nearAttacks = attacks.filter((attack) => attack.rangeInfo.hasNear || attack.rangeInfo.ranges.has('far'));
  const bestClose = closeAttacks.sort((a, b) => b.averageDamage - a.averageDamage)[0] || null;
  const bestNear = nearAttacks.sort((a, b) => b.averageDamage - a.averageDamage)[0] || null;
  return {
    attacks,
    bestClose,
    bestNear,
    preferNear: Boolean(bestNear && (!bestClose || bestNear.averageDamage >= bestClose.averageDamage))
  };
}

function getAverageDamage(expression) {
  const normalized = normalizeDamageExpression(expression);
  if (!normalized) {
    return 0;
  }
  const base = normalized.split("x")[0];
  const tokens = base.match(/[+\-]?[^+\-]+/g) || [];
  return tokens.reduce((total, token) => {
    const sign = token.startsWith("-") ? -1 : 1;
    const body = token.replace(/^[+\-]/, "");
    const dice = body.match(/^(\d*)d(\d+)$/i);
    if (dice) {
      const count = Number.parseInt(dice[1] || "1", 10);
      const sides = Number.parseInt(dice[2], 10);
      return total + sign * count * ((sides + 1) / 2);
    }
    const flat = Number.parseInt(body, 10);
    return Number.isFinite(flat) ? total + sign * flat : total;
  }, 0);
}

function getMonsterMoveSquares(monster) {
  const movement = String(monster?.movement || monster?.mv || monster?.["**MV**"] || "").toLowerCase();
  if (/triple\s+near/.test(movement)) {
    return 18;
  }
  if (/double\s+near/.test(movement)) {
    return 12;
  }
  if (/\bnear\b/.test(movement)) {
    return 6;
  }
  if (/\bclose\b/.test(movement)) {
    return 1;
  }
  if (/\bfar\b/.test(movement)) {
    return 12;
  }
  const explicit = parseSignedNumber(movement, 0);
  if (explicit > 0) {
    return explicit;
  }
  return 6;
}

function isMonsterMoveOccupied(monster, x, y, routeId = routeStep(state, monster, { x, y })?.routeId ?? routeOf(state, monster)) {
  return (state.characters || []).some((character) => routeOf(state, character) === routeId && !isFloatingDisc(character) && !isCharacterDead(character) && hasCharacterMapPosition(character) && Number(character.x) === x && Number(character.y) === y) ||
    getLiveMonsters().some((candidate) => routeOf(state, candidate) === routeId && candidate.id !== monster.id && Number(candidate.x) === x && Number(candidate.y) === y);
}

function canMonsterStep(monster, x, y) {
  if (isMonsterMoveOccupied(monster, x, y)) {
    return false;
  }
  if (isIncorporeal(monster)) return phaseStepAllowed(state, monster.x, monster.y, x, y);
  return canMoveBetweenTiles(state, Number(monster.x), Number(monster.y), x, y, { creature: monster }).ok;
}

function moveMonsterOneStep(monster, target, mode) {
  const tx = Number(target.x);
  const ty = Number(target.y);
  const candidates = [];
  for (let dx = -1; dx <= 1; dx += 1) {
    for (let dy = -1; dy <= 1; dy += 1) {
      if (dx === 0 && dy === 0) {
        continue;
      }
      const x = Number(monster.x) + dx;
      const y = Number(monster.y) + dy;
      if (!canMonsterStep(monster, x, y)) {
        continue;
      }
      candidates.push({
        x,
        y,
        distance: Math.max(Math.abs(x - tx), Math.abs(y - ty)),
        straightness: Math.abs(dx) + Math.abs(dy)
      });
    }
  }
  if (!candidates.length) {
    return false;
  }
  candidates.sort((a, b) => {
    const distanceSort = mode === "away" ? b.distance - a.distance : a.distance - b.distance;
    if (distanceSort) return distanceSort;
    return b.straightness - a.straightness;
  });
  const currentDistance = getMonsterDistanceToCharacter(monster, target);
  const next = candidates.find((candidate) => mode === "away" ? candidate.distance > currentDistance : candidate.distance < currentDistance);
  if (!next) {
    return false;
  }
  monster.routeId = routeStep(state, monster, next)?.routeId ?? routeOf(state, monster);
  monster.x = next.x;
  monster.y = next.y;
  monster.roomId = getTileAt(next.x, next.y)?.roomId ?? monster.roomId ?? null;
  return true;
}

function moveMonsterPlannedStep(monster, step) {
  const next = routeStep(state, monster, step);
  if (!next) return false;
  if (monster.conditions?.sinkhole && !isIncorporeal(monster)) return false;
  const door = getDoorBetween(state, monster.x, monster.y, step.x, step.y) || getDoorAt(state, step.x, step.y);
  if (!isIncorporeal(monster) && door && !['open', 'gone'].includes(door.doorState)) {
    if (door.secret && !door.secretFound && !door.revealed) return false;
    if (portalHeld(door)) {
      const attempt = forceHeldDoor(door, { ...monster, stats: { STR: monsterScore(monster, 'S') } }, rollCheck);
      monster.doorActionUsed = true; pushDiceHistory('Hold Portal', attempt.message);
      if (!attempt.opened) return false;
    } else if (door.doorState === 'locked') {
      monster.doorActionUsed = true;
      if (rollCheck(abilityScoreModifier(monsterScore(monster, 'S'))).total < (door.breakDc || 15)) return false;
      setDoorState(door, 'open');
    } else setDoorState(door, 'open');
    recomputeVisibility(state);
  }
  monster.x = step.x; monster.y = step.y; monster.routeId = next.routeId;
  monster.roomId = getTileAt(step.x, step.y)?.roomId ?? null;
  checkSinkholeFall(state, monster);
  return true;
}

async function moveMonsterForPlan(monster, target, preferNear, movement, {stopAt=1,rangedRange=RANGE_LIMITS.near}={}) {
  let moved = 0;
  if (preferNear) {
    const route = monsterFiringPosition(monster, target, rangedRange, movement, { preferRange: true });
    if (route) {
      for (const step of route.steps) {
        const cost = isIncorporeal(monster) ? 1 : movementStepCost(state, monster.x, monster.y);
        if (moved + cost > movement || !moveMonsterPlannedStep(monster, step)) break;
        moved += cost; render(); updatePanels(); await delay(200);
      }
      return moved;
    }
  }
  while (moved < movement) {
    const distance = getMonsterDistanceToCharacter(monster, target);
    const sight = sameRoute(state, monster, target) && (isIncorporeal(monster) || creatureSight(monster, target));
    const canMaterialize = !isIncorporeal(monster) || canMoveBetweenTiles(state, monster.x, monster.y, monster.x, monster.y, { routeId: routeOf(state, monster) }).ok && creatureSight(monster, target);
    if (preferNear && withinTargetRange(monster, target, rangedRange) && sight) {
      break;
    }
    if (!preferNear && distance <= stopAt && sight && canMaterialize) {
      break;
    }
    const mode = preferNear && distance <= 1 ? "away" : "toward";
    const cost = isIncorporeal(monster) ? 1 : movementStepCost(state, Number(monster.x), Number(monster.y));
    if (moved + cost > movement) break;
    if (mode === 'away') { if (!moveMonsterOneStep(monster, target, mode)) break; }
    else {
      const step = findPursuitStep(state, monster, target, {
        canStep: (fromX, fromY, x, y, point) => monsterCanPlanStep(monster, fromX, fromY, x, y, { routeId: point.routeId }),
        canAttackFrom: (x, y, target, point) => sameRoute(state, point, target) && withinTargetRange({ x, y }, target, preferNear ? rangedRange : stopAt) &&
          (!isIncorporeal(monster) || canMoveBetweenTiles(state, x, y, x, y, { routeId: point.routeId }).ok) &&
          (isIncorporeal(monster) || creatureSight(point, target))
      });
      if (!step) break;
      if (!moveMonsterPlannedStep(monster, step)) break;
    }
    moved += cost;
    render();
    updatePanels();
    await delay(200);
  }
  return moved;
}

function pickMonsterTarget(monster) {
  const targets = (state.characters || []).filter(isCharacterTargetableByMonster);
  if (!targets.length) {
    return null;
  }
  const attractor = targets.filter(character => hasWizardEffect(character, 'radioactive') && canMonsterSeeCharacter(monster, character))
    .sort((a, b) => getMonsterDistanceToCharacter(monster, a) - getMonsterDistanceToCharacter(monster, b))[0];
  if (attractor) { monster.combatTargetId = attractor.id; return attractor; }
  if(isDoppelganger(monster)&&monster.emulatedId)return targets.find(character=>character.id===monster.emulatedId)||targets.slice().sort((a,b)=>getMonsterDistanceToCharacter(monster,a)-getMonsterDistanceToCharacter(monster,b))[0];
  const stored = targets.find((character) => character.id === monster.combatTargetId);
  if (stored && getMonsterAttackPreference(monster).preferNear) {
    return stored;
  }
  const adjacent = targets.filter((character) => sameRoute(state, monster, character) && getMonsterDistanceToCharacter(monster, character) <= 1);
  if (adjacent.length) {
    const target = adjacent[Math.floor(Math.random() * adjacent.length)];
    monster.combatTargetId = target?.id || "";
    return target;
  }
  if (stored) {
    return stored;
  }
  const distances = targets.map((character) => ({
    character,
    distance: getMonsterDistanceToCharacter(monster, character)
  }));
  const closest = Math.min(...distances.map((entry) => entry.distance));
  const tied = distances.filter((entry) => entry.distance === closest).map((entry) => entry.character);
  const target = tied[Math.floor(Math.random() * tied.length)];
  monster.combatTargetId = target?.id || "";
  return target;
}

async function chooseMonsterAttack(monster, target) {
  const movement = Math.max(0, getMonsterMoveSquares(monster) - (monster.standingMovementCost || 0));
  if (shouldRepositionAfterDarkGuess(monster, { isIlluminated: point => isTileIlluminated(state, point.x, point.y, point) })) {
    const preference = getMonsterAttackPreference(monster);
    const attack = preference.preferNear ? preference.bestNear : preference.bestClose || preference.bestNear;
    const plan = attack && planDarkReposition(state, monster, target, {
      movement, preferRange: preference.preferNear,
      isIlluminated: (x, y, point) => isTileIlluminated(state, x, y, point),
      stepCost: (x, y) => movementStepCost(state, x, y),
      canStep: (fromX, fromY, x, y, point) => monsterCanPlanStep(monster, fromX, fromY, x, y, { routeId: point.routeId }),
      canAttackFrom: (x, y, point) => withinTargetRange(point, target, attack.rangeInfo.maxRange) && creatureSight({ ...monster, x, y, routeId: point.routeId }, target)
    });
    if (plan) {
      for (const step of plan.steps) { if (!moveMonsterPlannedStep(monster, step)) break; render(); await delay(200); }
      delete monster.darkGuess;
      return !monster.doorActionUsed && withinTargetRange(monster, target, attack.rangeInfo.maxRange) && canMonsterSeeCharacter(monster, target) ? attack : null;
    }
  }
  if(isDoppelganger(monster)&&monster.impersonationStarted) {
    let spent=0;
    const others=state.characters.filter(character=>character.id!==target.id&&!isCharacterDead(character)&&canMonsterSeeCharacter(monster,character));
    if(others.length) {
      const center={x:others.reduce((sum,c)=>sum+c.x,0)/others.length,y:others.reduce((sum,c)=>sum+c.y,0)/others.length};
      const positions=[[0,-1],[1,0],[0,1],[-1,0],[1,-1],[1,1],[-1,1],[-1,-1]].map(([dx,dy])=>({x:target.x+dx,y:target.y+dy})).filter(point=>
        getTileAt(point.x,point.y)?.type==='floor'&&!isMonsterMoveOccupied(monster,point.x,point.y));
      const between=positions.sort((a,b)=>Math.hypot(a.x-center.x,a.y-center.y)-Math.hypot(b.x-center.x,b.y-center.y))[0];
      if(between)spent=await moveMonsterForPlan(monster,between,false,movement,{stopAt:0});
    }
    await moveMonsterForPlan(monster,target,false,Math.max(0,movement-spent));
    if(!monster.doorActionUsed&&canMonsterSeeCharacter(monster,target)&&getMonsterDistanceToCharacter(monster,target)<=1)return getMonsterAttackOptions(monster).find(attack=>/dagger/i.test(attack.name))||getMonsterAttackOptions(monster)[0];
    return null;
  }
  if(monster.ambushAttack) {
    const preference = getMonsterAttackPreference(monster);
    const attack = preference.preferNear ? preference.bestNear : preference.bestClose;
    if(attack) {await moveMonsterForPlan(monster,target,preference.preferNear,movement,{rangedRange:attack.rangeInfo.maxRange});
      if(!monster.doorActionUsed&&canMonsterSeeCharacter(monster,target)&&withinTargetRange(monster,target,attack.rangeInfo.maxRange))return attack;}
    return null;
  }
  if(monster.canalSentry) {
    if(!canMonsterSeeCharacter(monster,target))return null;
    const distance=getMonsterDistanceToCharacter(monster,target);
    return getMonsterAttackOptions(monster).filter(attack=>
      (attack.rangeInfo.hasNear||attack.rangeInfo.ranges.has('far'))&&withinTargetRange(monster,target,attack.rangeInfo.maxRange))
      .sort((a,b)=>b.averageDamage-a.averageDamage)[0]||null;
  }
  const { bestClose, bestNear, preferNear } = getMonsterAttackPreference(monster);
  await moveMonsterForPlan(monster, target, preferNear, movement, { rangedRange: bestNear?.rangeInfo.maxRange || RANGE_LIMITS.near });
  if (!canMonsterSeeCharacter(monster, target) || monster.doorActionUsed) return null;
  const distance = getMonsterDistanceToCharacter(monster, target);
  if (preferNear && bestNear && distance >= 1 && withinTargetRange(monster, target, bestNear.rangeInfo.maxRange)) {
    return bestNear;
  }
  if (bestClose && distance <= RANGE_LIMITS.close) {
    return bestClose;
  }
  if (bestNear && distance >= 1 && withinTargetRange(monster, target, bestNear.rangeInfo.maxRange)) {
    return bestNear;
  }
  return null;
}

function applyMonsterAttack(monster, target, attack) {
  if (!sameRoute(state, monster, target)) return `${monster.name} cannot attack across separate passages.`;
  if (attack.rangeInfo.maxRange <= 1 && transformationMovementRules(state, target).levitating) return `${target.name} levitates beyond melee reach.`;
  if (blocksMindControl(state, target, attack.name || '')) return `${monster.name}'s ${attack.name} fails against the protection aura.`;
  const advantage = hasWizardEffect(target, 'purple-glow') || isStealthed(monster) || !canCharacterSeeMonster(target, monster);
  const hiddenAttack=isStealthed(monster),traits=JSON.stringify([monster.abilities,monster.talents]);
  const disadvantage = protectionDisadvantage(state, monster) || monster.turnedUndead?.rounds > 0 || monster.moraleFlight?.rounds > 0 || isInvisible(target) || monster.conditions?.blind || transformationAttackDisadvantage(monster, target);
  const roll = rollCheck(attack.bonus || 0, conditionAttackMode(target, { advantage, disadvantage,
    melee: attack.rangeInfo.maxRange <= 1, close: getMonsterDistanceToCharacter(monster, target) <= 1, state }));
  revealAfterOffense(monster);monster.ambushAttack=null;
  const ac = Number(target?.armorClass || 10) + detectThoughtsModifiers(state, target, monster).armorClass;
  const hit = roll.total >= ac;
  const luck = beginLuckEvent(state, { kind: 'monster-attack', actor: luckActorRef(monster), target: luckActorRef(target), roll, dc: ac,
    context: { weapon: attack.name, damage: 0 }, scope: state.characters.map(luckActorRef) });
  captureLuckActor(luck, target);
  const name = monster.name || "Monster";
  const logAttack = damage => {
    luck.context.damage = damage?.total || 0;
    finishLuckEvent(state, luck, { succeeded: hit });
    const parts = attackRollSegments({ character: { ...monster, name }, monster: { name: target.name, partyMember: true }, weapon: attack.name,
      roll, ability: 'attack', abilityModifier: attack.bonus || 0, hit, damage: damage?.total, damageRoll: damage });
    const message = parts.map(part => part.text).join(''); pushDiceHistory('Attack', message, null, parts); return message;
  };
  if (!hit) {
    return logAttack(null);
  }
  const mirror = interceptMirrorImageHit(state, target, { hit });
  if (mirror?.intercepted || mirror?.absorbed) { finishLuckEvent(state, luck, { succeeded: false }); return `${monster.name} destroys one of ${target.name}'s mirror images.`; }
  let expression = attack.damageExpression;
  if (target.conditions?.paralyzed && expression) expression = multiplyDamageDice(expression, 2);
  if(hiddenAttack&&/extra die of damage when undetected/i.test(traits))expression=multiplyDamageDice(expression,2);
  if(hiddenAttack&&/backstab/i.test(traits))expression=multiplyDamageDice(expression,2);
  if(state.combat.surpriseRound&&!state.combat.surpriseParticipantIds.includes(target.id)&&/execute.*x3 damage/i.test(traits))expression=multiplyDamageDice(expression,3);
  if (!expression) {
    return logAttack(null);
  }
  const damage = rollDamageExpression(expression);
  damage.total *= attackDamageMultiplier(target); damage.multiplier *= attackDamageMultiplier(target);
  const resistance = elementalDamage(target, damage.total, `${monster.name} ${attack.name} ${attack.text || ''} ${attack.damageExpression || ''}`);
  if (resistance.resistance) { damage.unresistedTotal = damage.total; damage.resistance = resistance.resistance; damage.total = resistance.total; }
  setCharacterHp(target, Number(target.hp || 0) - damage.total, { sourceId: monster.id });
  clearMagicLightIfIncapacitated(target);
  syncCharacterDyingRaw(target);
  applyDamageResultToPanel(damage, `${name} ${attack.name}`, { recordHistory: false });
  return logAttack(damage);
}

async function runMonsterTurn(monster) {
  if (!monster || !isLiveMonster(monster)) {
    return "";
  }
  monster.doorActionUsed = false;
  for (const resistance of resolveDetectThoughtsResistance(state, monster, { turnKey: `${state.combat.round}:${monster.id}`, ...tierTwoOptions() }))
    pushDiceHistory('Detect Thoughts', resistance.message);
  if (monster.conditions?.paralyzed) return `${monster.name} is paralyzed.`;
  if (isRestrainedByWeb(state, monster)) return escapeWeb(state, monster).message;
  if (isTied(monster)) {
    if (isSleeping(monster, state) || monster.conditions?.paralyzed) return `${monster.name} is tied and incapacitated.`;
    const method = Number(monster.S ?? monster['**S**'] ?? 0) >= Number(monster.D ?? monster['**D**'] ?? 0) ? 'break' : 'escape';
    const result = escapeRope(state, monster, method, pitActionOptions());
    return `${monster.name} ${result.escaped ? 'escapes the rope' : 'struggles against the rope'}: ${result.check.total} vs DC ${result.dc}.`;
  }
  if (monster.conditions?.sinkhole) {
    if (avoidsFalling(monster)) delete monster.conditions.sinkhole;
    else {
      if (isSleeping(monster, state) || monster.conditions.paralyzed) return `${monster.name} cannot climb out while incapacitated.`;
      try { return climbFromPit(state, monster, pitActionOptions()).message; }
      catch (error) { return `${monster.name}: ${error.message}`; }
    }
  }
  if (isSleeping(monster, state)) return `${monster.name} sleeps.`;
  const sleeper = !isIncorporeal(monster) && getLiveMonsters().find(ally => ally.id !== monster.id && isSleeping(ally, state) &&
    Math.max(Math.abs(ally.x - monster.x), Math.abs(ally.y - monster.y)) <= 1 && creatureSight(monster, ally));
  if (sleeper) { wakeCreature(sleeper, state); return `${monster.name} wakes ${sleeper.name}.`; }
  if (isProne(monster, state)) {
    delete monster.conditions.prone;
    monster.standingMovementCost = Math.ceil(getMonsterMoveSquares(monster) / 2);
  } else monster.standingMovementCost = 0;
  const movement = Math.max(0, getMonsterMoveSquares(monster) - monster.standingMovementCost);
  if (canPhase(monster)) {
    const target = pickMonsterTarget(monster);
    if (target) {
      const adjacent = getMonsterDistanceToCharacter(monster, target) <= 1;
      if (isIncorporeal(monster) && adjacent && canMoveBetweenTiles(state, monster.x, monster.y, monster.x, monster.y, { routeId: routeOf(state, monster) }).ok && creatureSight(monster, target)) {
        monster.conditions.incorporeal = false;
        render(); return `${monster.name} becomes corporeal.`;
      }
      if (!isIncorporeal(monster) && !creatureSight(monster, target)) {
        monster.conditions ||= {}; monster.conditions.incorporeal = true;
        await moveMonsterForPlan(monster, target, false, movement);
        return `${monster.name} becomes incorporeal and passes through the walls.`;
      }
      if (isIncorporeal(monster)) {
        await moveMonsterForPlan(monster, target, false, movement);
        return `${monster.name} drifts toward the party.`;
      }
    }
  }
  const flight=monster.turnedUndead?.rounds>0?monster.turnedUndead:monster.moraleFlight;
  if (flight?.rounds > 0) {
    const caster = state.characters.find(character => character.id === flight.casterId);
    if (caster) {
      let spent = 0;
      const visited = new Set([monster.x + ',' + monster.y]);
      while (spent < movement) {
        const cost = movementStepCost(state, Number(monster.x), Number(monster.y));
        if (spent + cost > movement) break;
        const step = chooseUndeadFleeStep(state, monster, caster, (fromX,fromY,x,y) =>
          !isMonsterMoveOccupied(monster,x,y) && canMoveBetweenTiles(state,fromX,fromY,x,y,{creature:monster}).ok, visited);
        if (!step) break;
        monster.routeId = routeStep(state, monster, step)?.routeId ?? routeOf(state, monster);
        monster.x = step.x; monster.y = step.y;
        monster.roomId = getTileAt(step.x,step.y)?.roomId ?? null;
        visited.add(step.x + ',' + step.y); spent += cost;
        render(); await delay(200);
      }
      const cornered = !chooseUndeadFleeStep(state, monster, caster, (fromX,fromY,x,y) =>
        !isMonsterMoveOccupied(monster,x,y) && canMoveBetweenTiles(state,fromX,fromY,x,y,{creature:monster}).ok);
      if (cornered) {
        const target = pickMonsterTarget(monster);
        const ranged = target && getMonsterAttackOptions(monster).filter(attack => attack.rangeInfo.maxRange > 1 &&
          getMonsterDistanceToCharacter(monster,target) <= attack.rangeInfo.maxRange && canMonsterSeeCharacter(monster,target))
          .sort((a,b) => b.averageDamage-a.averageDamage)[0];
        if (ranged) return applyMonsterAttack(monster,target,ranged);
      }
      return `${monster.name} ${spent ? 'flees' : 'is cornered and cannot flee'}.`;
    }
  }
  const target = pickMonsterTarget(monster);
  if (!target) {
    return `${monster.name || "Monster"} has no visible target.`;
  }
  const attack = await chooseMonsterAttack(monster, target);
  if (!attack) {
    return `${monster.name || "Monster"} moves.`;
  }
  return applyMonsterAttack(monster, target, attack);
}

async function runAutoMonsterTurns() {
  if (isSharedRoom()) return;
  const combat = ensureCombatState();
  if (combat.autoRunning) {
    return;
  }
  combat.autoRunning = true;
  const messages = [];
  try {
    while (isCombatActive()) {
      const entry = getCurrentCombatEntry();
      if (!entry || entry.type !== "monster") {
        break;
      }
      await announceCurrentTurn(entry);
      const monster = getMonsterById(entry.id);
      if (monster) {
        await delay(320);
        const message = await runMonsterTurn(monster);
        if (SERVER_RUNTIME) {
          state.monsterTurnSequence = (Number(state.monsterTurnSequence) || 0) + 1;
          const actor = Object.fromEntries(['id','type','name','level','hp','ac','attack','x','y','disguiseName','disguiseRevealed'].map(key => [key, monster[key]]));
          actor.name = displayMonsterName(monster);
          delete actor.disguiseName;
          const event = { sequence: state.monsterTurnSequence, at: Date.now(), actor,
            range: getMonsterAttackPreference(monster).preferNear ? getMonsterAttackPreference(monster).bestNear?.rangeInfo.maxRange || 6 : 1 };
          state.monsterTurnEvents = [...(state.monsterTurnEvents || []), event].slice(-12);
        }
        if (message) {
          messages.push(message);
          pushCombatLog(message);
        }
      }
      const combat = ensureCombatState();
      combat.turnIndex += 1;
      if (checkCombatEnd()) {
        break;
      }
      if (combat.turnIndex >= combat.turnOrder.length) {
        beginNextCombatRound(combat);
      }
      detectAdditionalCombatMonsters();
    }
  } finally {
    ensureCombatState().autoRunning = false;
  }
  if (messages.length && isCombatActive()) {
    setStatus(messages[messages.length - 1]);
  }
  if (isCombatActive()) {
    startCurrentCombatTurn();
  }
  render();
  updatePanels();
}

function handleCombatMovement(delta, options = {}) {
  const renderResult = options.render !== false;
  if (!isCombatActive()) {
    return false;
  }
  const character = getActiveCharacter(state);
  if (!isCurrentCharacterTurn(character)) {
    setStatus("Only the character whose turn it is can move.");
    return true;
  }
  if (!isCharacterAbleToAct(character)) {
    setStatus(`${character.name || "Character"} can't move.`);
    return true;
  }
  if (isProne(character, state)) { setStatus('Stand up before moving.'); return true; }
  const cost = movementStepCost(state, Number(character.x), Number(character.y), character);
  if (state.combat.movementRemaining < cost) {
    setStatus(`${character.name || "Character"} ${state.combat.movementRemaining ? 'needs 2 movement points to leave water.' : 'has no movement left.'}`);
    return true;
  }
  const blocked = combatStepBlock(state, character, Number(character.x) + delta[0], Number(character.y) + delta[1]);
  if (blocked) { setStatus(blocked); return true; }
  syncPlayerToActiveCharacter();
  const result = movePlayer(state, delta[0], delta[1], { deferVisibility: true });
  if (result.moved) {
    state.combat.movementRemaining = Math.max(0, state.combat.movementRemaining - cost);
    syncActiveCharacterToPlayer();
    if (!characterOccupant(state, Number(character.x), Number(character.y), character.id)) {
      state.combat.lastUnoccupiedPosition = { x: Number(character.x), y: Number(character.y), roomId: character.roomId, routeId: routeOf(state, character) };
    }
    recomputeVisibility(state);
    processMonsterVisibilityChange();
    detectAdditionalCombatMonsters();
    const ended = checkCombatEnd();
    markUserActivity();
    if (!ended) {
      setStatus(result);
      scheduleAutoEndTurnIfNeeded();
    }
    if (renderResult) {
      render();
      updatePanels();
    }
    return true;
  }
  markUserActivity();
  setStatus(result);
  if (renderResult) {
    render();
    updatePanels();
  }
  return true;
}

function updateMonsterHoverCursor() {
  if (SERVER_RUNTIME || !ui.mapHost) return;
  const panel = ui.mapHost.parentElement;
  let cursor = dragState ? 'grabbing' : 'grab';
  const character = state && getActiveCharacter(state);
  if (shiftAttackHeld || targetingMode?.kind === 'weapon') {
    const color = character && ownsCharacter(character) ? getCharacterColorValue(character) : '#000000';
    if (!attackCursorCache.has(color) && attackCursorImage?.naturalWidth) {
      const canvas = document.createElement("canvas");
      canvas.width = attackCursorImage.naturalWidth;
      canvas.height = attackCursorImage.naturalHeight;
      const context = canvas.getContext("2d");
      context.drawImage(attackCursorImage, 0, 0);
      context.globalCompositeOperation = "source-in";
      context.fillStyle = color;
      context.fillRect(0, 0, canvas.width, canvas.height);
      attackCursorCache.set(color, `url("${canvas.toDataURL("image/png")}") 1 1, crosshair`);
    }
    const source = attackCursorImage?.src || new URL('../assets/attack-alpha.png', import.meta.url).href;
    cursor = attackCursorCache.get(color) || `url("${source}") 1 1, crosshair`;
  }
  if (panel.style.cursor !== cursor) panel.style.cursor = cursor;
}

function applyLocalMovement(delta, options = {}) {
  if(state.encounterPrompt){setStatus('Resolve the monster reaction first.');return;}
  const actor = getActiveCharacter(state);
  if (isTied(actor)) { setStatus('Escape or break the rope before moving.'); return; }
  if (!SERVER_RUNTIME && options.render !== false && offerGrapplingEscape(actor, delta)) return;
  if (isFloatingDisc(actor)) { setStatus('Floating Disc follows its caster and cannot move independently.'); return; }
  if (!SERVER_RUNTIME && options.render !== false && localWaterMotions.has(actor?.id)) return;
  if (restInProgress(state)) { setStatus('Cancel rest before moving.'); return; }
  if (!pendingSpellAllowsCommand(getActiveCharacter(state), 'move')) { setStatus(pendingSpellMessage(getActiveCharacter(state))); return; }
  if (!SERVER_RUNTIME) { targetingMode = null; missileDisplay = null; }
  const renderResult = options.render !== false;
  if (handleCombatMovement(delta, options)) return;
  syncPlayerToActiveCharacter();
  const origin = { x: Number(state.player.x), y: Number(state.player.y) };
  const result = movePlayer(state, delta[0], delta[1], { deferVisibility: true });
  let sighting = null;
  let followersMoved = false;
  let lightPolygons;
  if (result.moved) {
    syncActiveCharacterToPlayer();
    if (actor && !SERVER_RUNTIME && options.render !== false && movementStepCost(state, origin.x, origin.y, actor) > 1) animateLocalWaterStep(actor, origin);
    lightPolygons = recomputeVisibility(state);
    sighting = processMonsterVisibilityChange();
    followersMoved = advanceMarchingOrder(getActiveCharacter(state), delta);
  }
  markUserActivity();
  if (!sighting?.combatStarted && !sighting?.combatEnded) setStatus(result);
  if (renderResult) {
    // Reuse only this step's lighting; followers and combat can change it again.
    render({ lightPolygons: !followersMoved && !sighting?.combatStarted && !sighting?.combatEnded ? lightPolygons : undefined });
    updatePanels({ charactersUnchanged: result.moved && !result.trapSprung && !followersMoved &&
      !isCombatActive() && !sighting?.combatStarted && !sighting?.combatEnded });
  }
}

function offerGrapplingEscape(actor, delta) {
  if (!actor?.conditions?.sinkhole || !delta || document.getElementById('grapple-escape-modal')) return false;
  const pit = pitAtBottom(state, actor);
  if (pit && (pit.cells || [{ x: pit.x, y: pit.y }]).some(cell => cell.x === actor.x + delta[0] && cell.y === actor.y + delta[1])) return false;
  const option = grapplingEscapeOption(state, actor, { ...pitActionOptions(), toward: { x: actor.x + delta[0], y: actor.y + delta[1] } });
  if (!option) return false;
  const modal = document.createElement('dialog'); modal.id = 'grapple-escape-modal'; modal.className = 'sd-save-menus sd-simple-dialog';
  modal.addEventListener('keydown', event => event.stopPropagation());
  const prompt = document.createElement('p'); prompt.textContent = 'Escape pit with grappling hook?';
  for (const choice of ['Yes', 'No']) {
    const button = document.createElement('button'); button.textContent = choice;
    button.onclick = () => { modal.close(); modal.remove(); if (choice === 'Yes') { try { performPitAction(actor, { action: 'grapple' }); } catch (error) { setStatus(error.message); } } };
    modal.append(button);
  }
  modal.prepend(prompt); modal.addEventListener('close', () => modal.remove()); document.body.append(modal); modal.showModal(); return true;
}

function createBackstabButton(character, attack) {
  if (character?.stealthed !== true) {
    return null;
  }
  const multiplier = getBackstabMultiplier(character);
  const backstabExpression = multiplyDamageDice(attack?.damageExpression, multiplier);
  if (!multiplier || !backstabExpression) {
    return null;
  }
  const button = document.createElement("button");
  button.type = "button";
  button.className = "damage-token backstab-roll-button";
  button.textContent = "B.stab";
  button.title = `Roll ${backstabExpression}`;
  button.addEventListener("click", (event) => {
    event.stopPropagation();
    applyDamageRoll({
      expression: backstabExpression,
      display: `${attack.name} Backstab x ${multiplier}`,
      context: `${attack.name} backstab ${backstabExpression}`
    }, `${character?.name || "Character"} backstab`, { character });
  });
  return button;
}

function getAttackGearNote(character, attack) {
  const attackName = String(attack?.name || "").toLowerCase();
  const item = (Array.isArray(character?.gear) ? character.gear : []).find((candidate) => {
    const name = String(candidate?.name || "")
      .replace(/\s*\([^)]*\)\s*/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
    return name && attackName.includes(name);
  });
  const note = String(item?.description || item?.detail || item?.notes || item?.note || "").trim();
  if (note) {
    return note;
  }
  return /\bcrossbow\b/.test(attackName) ? "skip move to reload, 2H" : "";
}

function getGearHoverNote(item) {
  const name = String(item?.name || "").toLowerCase();
  const note = String(item?.description || item?.detail || item?.notes || item?.note || "").trim();
  if (note) {
    return note;
  }
  return /\bcrossbow\b/.test(name) ? "skip move to reload, 2H" : "";
}

function appendCompactAttackDetail(target, attack, character) {
  const damageExpression = getAttackDamageExpression(attack);
  const gearNote = getAttackGearNote(character, attack);
  if (gearNote) {
    target.title = gearNote;
  }
  if (!damageExpression) {
    return;
  }
  target.append(document.createTextNode(", "));
  if (attack.name === "Unarmed") {
    target.append(document.createTextNode("1 damage"));
    return;
  }
  appendDamageAwareText(target, damageExpression, {
    sourceLabel: `${character?.name || "Character"} attack`,
    character
  });
}

function createAttackAwareLine(attackText, character) {
  if (isSpellCheckText(attackText)) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'attack-roll-button sd-sheet-spellcasting-button';
    button.textContent = 'Spellcasting';
    button.title = 'View known spells and choose a spell to cast.';
    button.addEventListener('click', event => {
      event.stopPropagation();
      void openSpellcastingMenu(character);
    });
    return button;
  }
  const attack = parseAttackText(attackText);
  if (!attack) {
    return document.createTextNode("");
  }
  const content = document.createElement("span");
  content.append(createAttackButton(character, attack));
  if (attack.flag) {
    content.append(document.createTextNode(attack.flag));
  }
  if (attack.bonusText) {
    content.append(document.createTextNode(` ${attack.bonusText}`));
  }
  if (attack.detail) {
    appendCompactAttackDetail(content, attack, character);
  }
  if(getBackstabMultiplier(character))content.title=`Backstab: ${multiplyDamageDice(getAttackDamageExpression(attack),getBackstabMultiplier(character))} damage`;
  applyAttackEquipmentState(content, character, attack);
  return content;
}

function formatAbilityPair(character, key) {
  const score = character.stats?.[key] ?? 10;
  return `${score} / ${formatModifier(abilityScoreModifier(score))}`;
}

function getCharacterColorValue(character) {
  if (isFloatingDisc(character)) return FLOATING_DISC_COLOR;
  const match = CHARACTER_COLOR_PALETTE.find((color) => color.id === character?.colorId);
  return match?.value || CHARACTER_COLOR_PALETTE[0].value;
}

function shuffleCoordinates(coords) {
  const shuffled = coords.slice();
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
  }
  return shuffled;
}

function hasCharacterMapPosition(character) {
  return (
    character?.x !== null &&
    character?.x !== undefined &&
    character?.y !== null &&
    character?.y !== undefined &&
    Number.isFinite(Number(character.x)) &&
    Number.isFinite(Number(character.y))
  );
}

function clampInt(value, min, max, fallback = 0) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) {
    return Math.max(min, Math.min(max, fallback));
  }
  return Math.max(min, Math.min(max, parsed));
}

function formatAttackForSheet(attackText) {
  return String(attackText || "").replace(/^ATTACKS?:\s*/i, "").trim();
}

function characterGearNames(character) {
  return (Array.isArray(character?.gear) ? character.gear : []).map((item) => String(item?.name || "").toLowerCase());
}

function characterHasGear(character, matcher) {
  return characterGearNames(character).some(matcher);
}

function characterHasTorch(character) {
  return characterHasGear(character, (name) => /^torch\b/.test(name));
}

function characterHasLantern(character) {
  return characterHasGear(character, (name) => /\blantern\b/.test(name));
}

function characterHasOil(character) {
  return characterHasGear(character, (name) => /\boil\b/.test(name));
}

function characterHasFlintAndSteel(character) {
  return characterHasGear(character, (name) => /flint\s*(?:and|&)?\s*steel/.test(name));
}

function isThief(character) {
  if(character?.companion?.kind==='doppelganger')return false;
  return /\bthie(?:f|ves)\b/i.test(String(character?.className || character?.class || ""));
}

function getCharacterGearUnitsByMatcher(character, matcher) {
  return (Array.isArray(character?.gear) ? character.gear : []).reduce((total, item) => {
    const name = String(item?.name || "").toLowerCase();
    return matcher(name, item) ? total + getGearUnits(item) : total;
  }, 0);
}

function getStackGroupSize(name) {
  const normalized = String(name || "").toLowerCase();
  if (/arrows?|bolts?/.test(normalized)) return 20;
  if (/rations?/.test(normalized)) return 3;
  if (/(?:iron\s+)?spikes?/.test(normalized)) return 10;
  if (/torches?/.test(normalized)) return 1;
  return 1;
}

function isEquipmentPileStackable(name) {
  return /arrows?|bolts?/i.test(String(name || ""));
}

function getGearUnits(item) {
  const units = Number.isFinite(Number(item?.totalUnits)) && Number(item.totalUnits) > 0
    ? Math.floor(Number(item.totalUnits))
    : Number.isFinite(Number(item?.quantity)) && Number(item.quantity) > 0
      ? Math.floor(Number(item.quantity))
      : 1;
  return Math.max(0, units);
}

function inferGearItemSlots(name, item = {}) {
  const normalizedName = String(name || "").toLowerCase();
  const treasureKind = String(item?.treasureKind || item?.kind || "").toLowerCase();
  if (item?.treasureItem === true || treasureKind) {
    if (treasureKind === "herbs" || treasureKind === "clothing" || treasureKind === "jewels" || treasureKind === "gems") {
      return 0;
    }
    if (treasureKind === "platemail") {
      return 3;
    }
    if (treasureKind === "chainmail") {
      return 2;
    }
    if (treasureKind === "leather") {
      return 1;
    }
  }
  if (/\bplate\s*(?:mail|armor)?\b/.test(normalizedName)) {
    return 3;
  }
  if (/(?:chainmail|bastard\s+sword|greatsword|greataxe)/.test(normalizedName)) {
    return 2;
  }
  return 1;
}

function getGearAmmoType(item) {
  const name = String(item?.name || "").toLowerCase();
  if (/arrow/.test(name) && !/bolt/.test(name)) return "arrows";
  if (/bolt/.test(name)) return "bolts";
  return "";
}

function characterHasWeaponForAmmo(character, ammoType) {
  const names = characterGearNames(character).join(" ");
  if (ammoType === "arrows") {
    return /\b(?:shortbow|longbow)\b/.test(names);
  }
  if (ammoType === "bolts") {
    return /\bcrossbow\b/.test(names);
  }
  return false;
}

function attackRequiresMissingAmmo(character, attackText) {
  const attackName = String(attackText || "").replace(/^ATTACKS?:\s*/i, "").split(":")[0].toLowerCase();
  const ammoType = /crossbow|bolt/.test(attackName)
    ? "bolts"
    : /shortbow|longbow|bow|arrow/.test(attackName)
      ? "arrows"
      : "";
  return Boolean(ammoType && getDisplayCharacterAmmo(character, ammoType) <= 0);
}

function getRenderableAttacks(character) {
  const attacks = (character?.attacks || []).filter(attackText => !isAmmoOnlyAttackText(attackText));
  for (const attack of transformationAttackOptions(state, character, { attackBonus: (actor, attack) => abilityScoreModifier(actor.stats?.[attack.rangeInfo?.maxRange > 1 ? 'DEX' : 'STR']) + classAttackBonus(actor) }))
    attacks.push(`${attack.name}: ${formatModifier(attack.bonus || 0)}, ${attack.damageExpression}, ${(attack.range ?? attack.rangeInfo?.maxRange ?? 1) <= 1 ? 'close' : (attack.rangeInfo?.maxRange || 6) > 6 ? 'far' : 'near'}`);
  if (!(character?.gear || []).some(item => handItemKind(item) === "weapon" && item.equipped) && !(character.companion&&attacks.length)) {
    attacks.push(`Unarmed: ${formatModifier(abilityScoreModifier(character?.stats?.STR))}, (1), close`);
  }
  return attacks;
}

function isAmmoOnlyAttackText(attackText) {
  const attack = parseAttackText(attackText);
  if (!attack) {
    return false;
  }
  return /^(?:arrows?|crossbow\s+bolts?|bolts?)$/i.test(String(attack.name || "").trim());
}

function getAttackGearIndex(character, attack) {
  const name = weaponIdentity(attack?.name);
  const profile = getWeaponProfileFromText(name);
  const gear=character?.gear||[];
  const exact=gear.map((item,index)=>({item,index})).filter(({item})=>handItemKind(item)==='weapon'&&weaponIdentity(getWeaponDisplayName(item,getWeaponProfile(item)))===name);
  if(exact.length)return (exact.find(({item})=>item.equipped)||exact[0]).index;
  return gear.findIndex(item=>handItemKind(item)==='weapon'&&profile&&getWeaponProfile(item)?.key===profile.key);
}

function isAttackEquipped(character, attack) {
  if (transformationAttackOptions(state, character).some(option => option.name.toLowerCase() === String(attack?.name).toLowerCase())) return true;
  if(character.companion&&getAttackGearIndex(character,attack)<0&&!getWeaponProfileFromText(attack?.name))return true;
  const index = getAttackGearIndex(character, attack);
  return index < 0 ? attack?.name === "Unarmed" && !(character?.gear || []).some(item => item.equipped && handItemKind(item) === "weapon")
    : character.gear[index].equipped === true && !attackRequiresMissingAmmo(character, attack?.name);
}

function changeCharacterEquipment(character, index, equipped) {
  if (sendSharedCommand("equip", { gear_index: index, equipped }, character)) return;
  const current = getCurrentCharacter(character);
  const item = current?.gear?.[index];
  const torches = (current?.gear || []).filter(gear => gear.equipped && handItemKind(gear) === 'torch');
  syncElapsedTime(state);
  if (!item || (!handItemKind(item)&&!isArmorItem(item))) return;
  if(!canUseCharacterInventory(current)||!canControlCharacter(current)||inventoryController(current)?.pendingSpell){
    if(SERVER_RUNTIME)throw new Error('This character cannot change equipment now.');
    return;
  }
  if (isFloatingDisc(current) && handItemKind(item) !== 'lantern') {
    if (SERVER_RUNTIME) throw new Error('Floating Disc can equip only lanterns.');
    setStatus('Floating Disc can equip only lanterns.'); return;
  }
  if(isArmorItem(item)) {
    if(isCombatActive()){if(SERVER_RUNTIME)throw new Error('Armor cannot be changed during combat.');return;}
    if(!canUseArmor(current,item)){if(SERVER_RUNTIME)throw new Error('This character cannot use that armor.');return;}
    equipArmor(current,index,equipped,isArmorItem);
  }else {
    if(current.companion?.kind==='doppelganger'&&(!item.bound||!equipped)){
      if(SERVER_RUNTIME)throw new Error('This character can only equip their dagger.');
      setStatus('This character can only equip their dagger.');return;
    }
    if (isShieldItem(item) && !canUseShield(current)) {if(SERVER_RUNTIME)throw new Error('This character cannot use shields.');return;}
    if (handItemKind(item) === "weapon" && !canUseWeapon(current, item)) {if(SERVER_RUNTIME)throw new Error('This character cannot use that weapon.');return;}
    if (equipped && (!availableHands(current) || availableHands(current) < 2 && isTwoHandedWeapon(item))) { if (SERVER_RUNTIME) throw new Error('Petrified arms prevent equipping this item.'); setStatus('Petrified arms prevent equipping this item.'); return; }
    if (!consumeCharacterCombatAction(current)) {
      if (SERVER_RUNTIME) throw new Error('This character has already acted this turn.');
      return;
    }
    equipItem(current, index, equipped);
  }
  releaseUnequippedTorches(current, torches, dropped => {
    const pile = createDroppedGearEntity(dropped, current, dropped.lit ? 'torch' : '');
    state.entities.push(pile);
  });
  syncCharacterEquipmentDerivedStats(current);
  syncPlayerLightFromActiveCharacter();
  recomputeVisibility(state);
  markUserActivity();
  markRunDirty();
  refreshCharacterViews(current);
  render();
  updatePanels();
}

function createEquipmentCheckbox(character, index, labelText = "Equip") {
  const label = document.createElement("label");
  label.className = "sd-equipment-toggle";
  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.checked = character.gear[index].equipped === true;
  checkbox.setAttribute("aria-label", `Equip ${character.gear[index].name}`);
  label.title = checkbox.getAttribute("aria-label");
  label.addEventListener("click", event => event.stopPropagation());
  label.addEventListener("keydown", event => event.stopPropagation());
  checkbox.addEventListener("change", () => changeCharacterEquipment(character, index, checkbox.checked));
  label.append(checkbox, document.createTextNode(labelText));
  return label;
}

function applyAttackEquipmentState(container, character, attack) {
  const index = getAttackGearIndex(character, attack);
  if (index < 0) return;
  const equipped = isAttackEquipped(character, attack);
  container.classList.toggle("is-attack-unequipped", !equipped);
  if (!equipped) container.querySelectorAll("button").forEach(button => { button.disabled = true; });
}

const WEAPON_PROFILES = [
  { key: "bastard sword", pattern: /\bbastard\s+sword\b/, damage: "1d8", versatileDamage: "1d10", ability: "STR" },
  { key: "greatsword", pattern: /\bgreatsword\b/, damage: "1d12", ability: "STR" },
  { key: "greataxe", pattern: /\bgreataxe\b/, damage: "1d8", versatileDamage: "1d10", ability: "STR" },
  { key: "greatclub", pattern: /\bgreatclub\b/, damage: "1d8", ability: "STR" },
  { key: "polearm", pattern: /\bpolearm\b/, damage: "1d10", ability: "STR" },
  { key: "halberd", pattern: /\bhalberd\b/, damage: "1d10", ability: "STR" },
  { key: "longsword", pattern: /\blongsword\b/, damage: "1d8", ability: "STR" },
  { key: "shortsword", pattern: /\bshortsword\b/, damage: "1d6", ability: "STR" },
  { key: "warhammer", pattern: /\bwarhammer\b/, damage: "1d10", ability: "STR" },
  { key: "mace", pattern: /\bmace\b/, damage: "1d6", ability: "STR" },
  { key: "club", pattern: /\bclub\b/, damage: "1d4", ability: "STR" },
  { key: "dagger", pattern: /\bdagger\b/, damage: "1d4", ability: "DEX" },
  { key: "staff", pattern: /\bstaff\b/, damage: "1d4", ability: "STR" },
  { key: "spear", pattern: /\bspear\b/, damage: "1d6", ability: "STR", thrown: true },
  { key: "javelin", pattern: /\bjavelin\b/, damage: "1d4", ability: "STR", thrown: true },
  { key: "longbow", pattern: /\blongbow\b/, damage: "1d8", ability: "DEX", ammo: "arrows" },
  { key: "shortbow", pattern: /\bshortbow\b/, damage: "1d4", ability: "DEX", ammo: "arrows" },
  { key: "crossbow", pattern: /\bcrossbow\b/, damage: "1d6", ability: "DEX", ammo: "bolts" },
  { key: "sword", pattern: /^sword$/, damage: "1d6", ability: "STR" }
];

const ARMOR_PROFILES = [
  { key: "mithral chainmail", pattern: /\bmithral\s+chainmail\b/, ac: 13 },
  { key: "chainmail", pattern: /\bchainmail\b/, ac: 13 },
  { key: "plate", pattern: /\b(?:plate\s+mail|plate armor|plate)\b/, ac: 15 },
  { key: "half plate", pattern: /\bhalf\s+plate\b/, ac: 14 },
  { key: "leather", pattern: /\bleather(?:\s+armor)?\b/, ac: 11 }
];

function normalizeEquipmentName(value) {
  return normalizeWeaponSpacing(value)
    .replace(/\([^)]*\)/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function getGearItemName(item) {
  return String(item?.name || "").trim();
}

function getWeaponProfileFromText(value) {
  const normalized = normalizeEquipmentName(value);
  return WEAPON_PROFILES.find((profile) => profile.pattern.test(normalized)) || null;
}

function getWeaponProfile(item) {
  if(getGearAmmoType(item)&&String(item?.type||'').toLowerCase()!=='weapon')return null;
  const treasureKind = String(item?.treasureKind || item?.kind || "").toLowerCase();
  if (item?.treasureItem === true && treasureKind === "dagger") {
    return WEAPON_PROFILES.find((profile) => profile.key === "dagger") || null;
  }
  return getWeaponProfileFromText(getGearItemName(item));
}

function getArmorProfile(item) {
  const explicit = Number(item?.ac ?? item?.armorClass);
  if (!isShieldItem(item) && explicit >= 11 && explicit <= 15 &&
      (item?.type === 'armor' || item?.magic?.kind === 'armor')) {
    const key = /mithral\s+chainmail/i.test(item.name || '') ? 'mithral chainmail' : explicit >= 15 ? 'plate' : explicit >= 13 ? 'chainmail' : 'leather';
    return { key, ac: explicit };
  }
  const treasureKind = String(item?.treasureKind || item?.kind || "").toLowerCase();
  if (item?.treasureItem === true) {
    if (treasureKind === "platemail") {
      return ARMOR_PROFILES.find((profile) => profile.key === "plate") || null;
    }
    if (treasureKind === "chainmail") {
      return ARMOR_PROFILES.find((profile) => profile.key === "chainmail") || null;
    }
    if (treasureKind === "leather") {
      return ARMOR_PROFILES.find((profile) => profile.key === "leather") || null;
    }
  }
  const normalized = normalizeEquipmentName(getGearItemName(item));
  return ARMOR_PROFILES.find((profile) => profile.pattern.test(normalized)) || null;
}

function isShieldItem(item) {
  const treasureKind = String(item?.treasureKind || item?.kind || "").toLowerCase();
  if (item?.treasureItem === true && treasureKind === "shield") {
    return true;
  }
  return /\bshield\b/i.test(getGearItemName(item));
}

function isWeaponItem(item) {
  return Boolean(getWeaponProfile(item));
}

function isArmorItem(item) {
  return Boolean(getArmorProfile(item));
}

function isVersatileWeaponItem(item) {
  const profile = getWeaponProfile(item);
  return Boolean(profile?.versatileDamage || /\bgreataxe\b/i.test(getGearItemName(item)) || /\(v\)|versatile|\/\s*\d*d\d+/i.test(`${item?.name || ""} ${item?.damage || ""}`));
}

function characterHasShield(character) {
  return (Array.isArray(character?.gear) ? character.gear : []).some(isShieldItem);
}

function characterHasVersatileWeapon(character) {
  return (Array.isArray(character?.gear) ? character.gear : []).some(isVersatileWeaponItem);
}

function shouldReadyShield(character) {
  return (character?.gear || []).some(item => isShieldItem(item) && item.equipped === true);
}

function normalizeArmorMasteryTarget(value) {
  const normalized = String(value || "").toLowerCase();
  if (/\bshield/.test(normalized)) {
    return "shield";
  }
  if (/\bleather/.test(normalized)) {
    return "leather";
  }
  if (/\bchainmail/.test(normalized)) {
    return "chainmail";
  }
  if (/\bplate/.test(normalized)) {
    return "plate";
  }
  return "";
}

function getArmorMasteryTarget(character) {
  const lines = [
    ...(Array.isArray(character?.levels) ? character.levels : []).map((level) => `${level?.talentRolledName || ""}: ${level?.talentRolledDesc || ""}`),
    ...(Array.isArray(character?.bonuses) ? character.bonuses : []).map((bonus) => `${bonus?.bonusName || bonus?.name || ""}: ${bonus?.bonusTo || ""}`),
    ...(Array.isArray(character?.raw?.levels) ? character.raw.levels : []).map((level) => `${level?.talentRolledName || ""}: ${level?.talentRolledDesc || ""}`),
    ...(Array.isArray(character?.raw?.bonuses) ? character.raw.bonuses : []).map((bonus) => `${bonus?.bonusName || bonus?.name || ""}: ${bonus?.bonusTo || ""}`)
  ];
  const explicit = lines.find((line) => /armor mastery/i.test(line) && !/choose one kind/i.test(line));
  return normalizeArmorMasteryTarget(explicit);
}

function getCharacterTalentSearchLines(character) {
  return [
    ...(Array.isArray(character?.levels) ? character.levels : []).map((level) => `${level?.talentRolledName || ""}: ${level?.talentRolledDesc || ""}`),
    ...(Array.isArray(character?.bonuses) ? character.bonuses : []).map((bonus) => `${bonus?.bonusName || bonus?.name || ""}: ${bonus?.bonusTo || ""}`),
    ...(Array.isArray(character?.raw?.levels) ? character.raw.levels : []).map((level) => `${level?.talentRolledName || ""}: ${level?.talentRolledDesc || ""}`),
    ...(Array.isArray(character?.raw?.bonuses) ? character.raw.bonuses : []).map((bonus) => `${bonus?.bonusName || bonus?.name || ""}: ${bonus?.bonusTo || ""}`)
  ];
}

function characterHasFighterMeleeRangedTalent(character) {
  if (!/\bfighter\b/.test(getCharacterClassKey(character))) {
    return false;
  }
  return getCharacterTalentSearchLines(character).some((line) => /melee\s+and\s+ranged\s+attacks/i.test(line));
}

function normalizeWeaponMasteryTarget(value) {
  const profile = getWeaponProfileFromText(value);
  return profile?.key || "";
}

function getWeaponMasteryTarget(character) {
  const normalizedTalentLines = buildTalentSpellLines(character).map(formatTalentSpellTextForSheet);
  for (const line of [...getCharacterTalentSearchLines(character), ...normalizedTalentLines]) {
    if (
      !/mastery/i.test(line) ||
      /armor\s*mastery/i.test(line) ||
      /choose one weapon/i.test(line)
    ) {
      continue;
    }
    const target = normalizeWeaponMasteryTarget(line);
    if (target) {
      return target;
    }
  }
  return "";
}

function getCharacterClassKey(character) {
  return String(character?.className || character?.class || "").toLowerCase();
}

function canUseWeapon(character, itemOrName) {
  if (!availableHands(character) || availableHands(character) < 2 && isTwoHandedWeapon(typeof itemOrName === 'string' ? { name: itemOrName } : itemOrName)) return false;
  if (character.companion?.kind==='doppelganger') return /dagger/i.test(typeof itemOrName==='string'?itemOrName:itemOrName?.name||'');
  const profile = typeof itemOrName === "string" ? getWeaponProfileFromText(itemOrName) : getWeaponProfile(itemOrName);
  if (!profile) {
    return false;
  }
  const classKey = companionEquipmentClass(character) || getCharacterClassKey(character);
  if (/\bfighter\b/.test(classKey)) {
    return true;
  }
  if (/\bwizard\b/.test(classKey)) {
    return profile.key === "dagger" || profile.key === "staff";
  }
  if (/\bthief\b/.test(classKey)) {
    return ["club", "crossbow", "shortsword", "dagger", "shortbow"].includes(profile.key);
  }
  if (/\bpriest\b/.test(classKey)) {
    return ["club", "crossbow", "dagger", "mace", "longsword", "staff", "warhammer"].includes(profile.key);
  }
  return true;
}

function characterArmorDescription(character) {
  const armor=(character.gear||[]).filter(item=>item.equipped&&isArmorItem(item)&&canUseArmor(character,item)).map(item=>item.name);
  const shield=(character.gear||[]).find(item=>isShieldItem(item)&&item.equipped&&canUseShield(character));
  const magicalArmor = mageArmorEffect(character);
  return `${magicalArmor ? `Mage Armor: AC ${magicalArmor.armorClass}, ${magicalArmor.rounds} rounds remaining. ` : ''}Armor: ${armor.join(', ')||'none'}. Shield: ${shield?.name||'none'}.`;
}

function performHalflingInvisibility(character) {
  if(sendSharedCommand('ancestry_invisibility',{},character))return;
  if(isCombatActive()&&!isCurrentCharacterTurn(character)){setStatus('Wait for this character\'s turn.');return;}
  try {setStatus(activateHalflingInvisibility(character));markRunDirty();markUserActivity();updatePanels();render();}
  catch(error){if(SERVER_RUNTIME)throw error;setStatus(error.message);}
}

function canUseArmor(character, item) {
  if (character.companion?.kind==='doppelganger')return false;
  const profile = getArmorProfile(item);
  if (!profile) {
    return false;
  }
  const classKey = companionEquipmentClass(character) || getCharacterClassKey(character);
  if (/\bwizard\b/.test(classKey)) {
    return false;
  }
  if (/\bthief\b/.test(classKey)) {
    const ac = Number(item.ac ?? item.armorClass ?? profile.ac);
    return ac <= 12 || profile.key === "mithral chainmail";
  }
  return true;
}

function canUseShield(character) {
  if (!availableHands(character)) return false;
  if (character.companion?.kind==='doppelganger')return false;
  return !/\b(?:wizard|thief)\b/.test(companionEquipmentClass(character) || getCharacterClassKey(character));
}

function ensureEquipmentBaseline(character) {
  if (!character) {
    return;
  }
  const raw = character.raw || {};
  const currentAttacks = Array.isArray(character.attacks) ? character.attacks : [];
  const rawBaseAttacks = Array.isArray(raw.baseAttacks) ? raw.baseAttacks : null;
  const characterBaseAttacks = Array.isArray(character.baseAttacks) ? character.baseAttacks : null;
  const baseAttacks = rawBaseAttacks || characterBaseAttacks || currentAttacks;
  character.baseAttacks = JSON.parse(JSON.stringify(baseAttacks));
  character.baseArmorClass = Number.isFinite(Number(character.baseArmorClass))
    ? Number(character.baseArmorClass)
    : Number.isFinite(Number(raw.baseArmorClass))
      ? Number(raw.baseArmorClass)
      : Number.isFinite(Number(character.armorClass))
        ? Number(character.armorClass)
        : 10;
  character.raw = raw;
  character.raw.baseAttacks = JSON.parse(JSON.stringify(character.baseAttacks));
  character.raw.baseArmorClass = character.baseArmorClass;
  character.raw.shieldReadied = character.shieldReadied !== false;
}

function getWeaponDisplayName(item, profile) {
  const rawName = getGearItemName(item);
  if (rawName) {
    return stripWeaponFlags(rawName);
  }
  return prettifyAttackName(profile?.key || "Weapon");
}

function stripWeaponFlags(name) {
  return String(name||'').replace(/\s*\((?:C|N|F|V|FIN|2H|close|near|far)(?:\s*\/\s*(?:C|N|F|V|FIN|2H|close|near|far))*\)\s*/gi,' ').replace(/\s+/g,' ').trim();
}

const weaponIdentity=name=>normalizeWeaponSpacing(stripWeaponFlags(name));

function getWeaponDamageExpression(character, item, profile) {
  const explicitDamage = String(item?.damage || item?.damageExpression || "").trim();
  if (explicitDamage && !profile?.versatileDamage) {
    return explicitDamage;
  }
  if (profile?.versatileDamage) {
    return hasOccupiedOffHand(character) ? profile.damage : profile.versatileDamage;
  }
  return explicitDamage || profile?.damage || "1d4";
}

function addDamageBonus(damageExpression, bonus) {
  const amount = Number(bonus) || 0;
  if (!amount) {
    return damageExpression;
  }
  const source = String(damageExpression || "").trim();
  if (!source) {
    return source;
  }
  const match = source.match(/^(.*?)([+-]\d+)?$/);
  const base = match?.[1] || source;
  const currentBonus = Number.parseInt(match?.[2] || "0", 10) || 0;
  return `${base}${formatModifier(currentBonus + amount)}`;
}

function buildWeaponAttackText(character, item) {
  const profile = getWeaponProfile(item);
  if (!profile || !canUseWeapon(character, item)) {
    return "";
  }
  const baseBonus = Number.isFinite(Number(item?.attackBonus))
    ? Number(item.attackBonus)
    : abilityScoreModifier(character?.stats?.[profile.ability || "STR"]);
  const masteryApplies = masteryTargets(character).some(target => normalizeWeaponMasteryTarget(target) === profile.key) || getWeaponMasteryTarget(character) === profile.key;
  const mastery = masteryApplies ? 1 + Math.floor((character.level || 1) / 2) : 0;
  const talents = classAttackBonus(character, Boolean(profile.ammo || profile.thrown));
  const bonus = baseBonus
    + (talents || (characterHasFighterMeleeRangedTalent(character) ? 1 : 0))
    + mastery + holyWeaponBonus(item) + revealedMagicBonus(item);
  const baseDamage = addDamageBonus(getWeaponDamageExpression(character, item, profile), mastery + holyWeaponBonus(item) + revealedMagicBonus(item));
  const damage = `${baseDamage}${item?.magic?.identified && item.magic.elementDice ? ` + ${item.magic.elementDice} ${item.magic.element} damage` : ''}`;
  const flag = profile.versatileDamage ? " (V)" : "";
  return `${getWeaponDisplayName(item, profile)}${flag}: ${formatModifier(bonus)}, ${damage}`;
}

function getAttackWeaponProfile(attackText) {
  const attack = parseAttackText(attackText);
  return attack ? getWeaponProfileFromText(attack.name) : null;
}

function characterCarriesWeapon(character, profile) {
  return (Array.isArray(character?.gear) ? character.gear : [])
    .some((item) => getWeaponProfile(item)?.key === profile?.key);
}

function mergeUniqueAttack(attacks, attackText) {
  if (!attackText) {
    return;
  }
  const attack = parseAttackText(attackText);
  const key = attack ? `${attack.name.toLowerCase()}|${attack.flag || ""}` : String(attackText).toLowerCase();
  const exists = attacks.some((candidate) => {
    const parsed = parseAttackText(candidate);
    const candidateKey = parsed ? `${parsed.name.toLowerCase()}|${parsed.flag || ""}` : String(candidate).toLowerCase();
    return candidateKey === key;
  });
  if (!exists) {
    attacks.push(attackText);
  }
}

function rebuildCharacterAttacks(character) {
  ensureEquipmentBaseline(character);
  const nextAttacks = [];
  const spellcaster=/\b(?:priest|wizard)\b/i.test(character.className)&&!character.companion;
  if(spellcaster)mergeUniqueAttack(nextAttacks,`SPELLS: To cast a ${character.className} spell, roll 1d20${formatModifier(getSpellCastingModifier(character,{tier:1}))} vs a DC equal to 10 + the spell's tier.`);
  const seen=new Set();
  for(const item of character.gear||[])if(isWeaponItem(item)&&canUseWeapon(character,item)) {
    const name=weaponIdentity(getWeaponDisplayName(item,getWeaponProfile(item)));
    if(seen.has(name))continue;
    seen.add(name);
    const representative=character.gear.find(other=>other.equipped&&weaponIdentity(getWeaponDisplayName(other,getWeaponProfile(other)))===name)||item;
    mergeUniqueAttack(nextAttacks,buildWeaponAttackText(character,representative));
  }
  if(character.companion)for(const attackText of character.baseAttacks||[])if(!getAttackWeaponProfile(attackText)&&!isBackstabAttackText(attackText))mergeUniqueAttack(nextAttacks,attackText);
  character.attacks = nextAttacks;
  character.raw.attacks = JSON.parse(JSON.stringify(nextAttacks));
}

function rebuildCharacterArmorClass(character) {
  ensureEquipmentBaseline(character);
  const magicalArmor = mageArmorEffect(character);
  if (magicalArmor) {
    character.armorClass = magicalArmor.armorClass;
    character.raw.armorClass = character.armorClass;
    character.raw.ac = character.armorClass;
    return;
  }
  if(character.companion?.kind === 'doppelganger') {
    character.armorClass=(Number.parseInt(character.companion.source.ac,10)||10)+faithArmorBonus(character);
    character.raw.armorClass=character.armorClass;character.raw.ac=character.armorClass;
    return;
  }
  const dexModifier = abilityScoreModifier(character?.stats?.DEX);
  let naturalArmor = 10 + dexModifier;
  if (character.companion) {
    const originalGear = nativeGear(character.companion.source);
    if (!originalGear.some(item => isArmorItem(item) && !isShieldItem(item))) {
      naturalArmor = (Number.parseInt(character.companion.source.ac, 10) || 10) - (originalGear.some(isShieldItem) ? 2 : 0);
    }
  }
  let armorClass = naturalArmor;
  let armorMasteryApplies = false;
  let armorTalent = 0;
  const masteryTarget = getArmorMasteryTarget(character);
  for (const item of character.gear || []) {
    if (!item.equipped || !isArmorItem(item) || !canUseArmor(character, item)) {
      continue;
    }
    const explicit = Number(item?.armorClass ?? item?.ac);
    const profile = getArmorProfile(item);
    const armorDex = profile?.key === "plate" ? 0 : dexModifier;
    const wornAc = (Number.isFinite(explicit) ? explicit : profile?.ac || 10) + armorDex;
    const itemAc = (character.companion ? Math.max(naturalArmor, wornAc) : wornAc) + magicBonus(item);
    if (itemAc > armorClass) {
      armorClass = itemAc;
      armorMasteryApplies = masteryTarget && masteryTarget === profile?.key;
      armorTalent = classArmorBonus(character, profile?.key || 'none', Number.isFinite(explicit) ? explicit : profile?.ac);
    }
  }
  if (characterHasShield(character) && canUseShield(character) && shouldReadyShield(character)) {
    armorClass += 2 + magicBonus(character.gear.find(item => isShieldItem(item) && item.equipped));
    armorClass += classArmorBonus(character, 'shield') || (masteryTarget === 'shield' ? 1 : 0);
  }
  armorClass += armorTalent || (armorMasteryApplies ? 1 : 0);
  character.armorClass = Math.max(0, Math.min(99, armorClass + faithArmorBonus(character)));
  character.raw.armorClass = character.armorClass;
  character.raw.ac = character.armorClass;
  character.raw.shieldReadied = character.shieldReadied !== false;
}

function syncCharacterEquipmentDerivedStats(character) {
  if (!character) {
    return;
  }
  const heldTorches = (character.gear || []).filter(item => item.equipped && handItemKind(item) === 'torch');
  ensureEquipment(character, item => isShieldItem(item) ? canUseShield(character)
    : handItemKind(item) === "weapon" ? canUseWeapon(character, item) : true);
  if (availableHands(character) < 2) releaseUnequippedTorches(character, heldTorches, dropped => {
    state.entities.push(createDroppedGearEntity(dropped, character, dropped.lit ? 'torch' : ''));
  });
  if (isFloatingDisc(character)) {
    for (const item of character.gear || []) if (handItemKind(item) !== 'lantern') item.equipped = false;
    character.attacks = []; character.hp = 0; character.maxHitPoints = 0; character.armorClass = 0;
    return;
  }
  ensureArmorEquipment(character,{isArmor:isArmorItem,canEquip:item=>canUseArmor(character,item),
    score:item=>Number(item.armorClass??item.ac??getArmorProfile(item)?.ac)||0});
  rebuildCharacterAttacks(character);
  rebuildCharacterArmorClass(character);
  if (isCombatActive() && getCurrentCombatEntry()?.id === character.id) {
    const budget = characterMovementBudget(character), oldBudget = state.combat.movementBudget ?? budget;
    if (budget !== oldBudget) {
      const spent = Math.max(0, oldBudget - state.combat.movementRemaining);
      if (character.conditions?.sinkhole && oldBudget > 0) character.conditions.sinkholeMovementSpent = spent;
      state.combat.movementBudget = budget; state.combat.movementRemaining = Math.max(0, budget - spent);
    }
  }
}

function syncAllCharacterEquipmentDerivedStats() {
  if (!state?.characters?.length) {
    return;
  }
  for (const character of state.characters) {
    clearInvalidCharacterLight(character);
    if (character.dead || character.slain || Number(character.hp) <= 0) character.focusSpell = null;
    syncCharacterEquipmentDerivedStats(character);
  }
}

function setCharacterLight(character, source, gearIndex = null) {
  if (!character) {
    return;
  }
  ensureEquipment(character);
  if (source === "light-spell") character.lightSpellLit = true;
  else if (source) {
    const heldIndex = character.gear.findIndex(item => getGearLightSource(item) === source && item.equipped);
    const index = Number.isInteger(gearIndex) ? gearIndex : heldIndex >= 0 ? heldIndex
      : character.gear.findIndex(item => getGearLightSource(item) === source);
    if (index >= 0) {
      character.gear[index].lit = true;
      character.gear[index].covered = false;
      equipItem(character, index, true);
    }
  } else {
    if (character.lightSource === "light-spell") character.lightSpellLit = false;
    else {
      const item = character.gear.find(item => item.equipped && item.lit && getGearLightSource(item));
      if (item) item.lit = false;
    }
  }
  syncEquipmentLight(character);
}

function hideCharacterLight(character) {
  if (!character?.lightSource) {
    return;
  }
  const item = character.gear?.find(item => item.equipped && item.lit && getGearLightSource(item) === "lantern");
  if (item) item.covered = true;
  syncEquipmentLight(character);
}

function isStartingRoomIlluminated(importedCharacter) {
  const roomId = state.generation?.entranceRoomId || importedCharacter.roomId;
  const tiles = state.tiles.filter(tile => tile.roomId === roomId && tile.type === "floor");
  const sources = [
    ...(state.characters || []).filter(character => character.id !== importedCharacter.id && Number(character.lightRadius) > 0),
    ...(state.entities || []).filter(entity => entity.subtype === "dropped-equipment" && !entity.collected && Number(entity.lightRadius) > 0)
  ];
  // Ignore preview light, the incoming character, and each viewer's fog-of-war filter.
  return sources.some(source => tiles.some(tile => isPointInLightRadius(tile.x, tile.y, source) &&
    creatureSight(source, { ...tile, routeId: routeAt(state, tile.x, tile.y, routeOf(state, source)) })));
}

function initializeImportedCharacterLight(character) {
  if (!character) return;
  const chooseLoadout = character.equipmentInitialized !== true;
  const firstLight = !ensureTimers(state).lightEverLit;
  const needsLight = !isStartingRoomIlluminated(character);
  syncCharacterEquipmentDerivedStats(character);
  if (chooseLoadout) {
    const mastery = /\bfighter\b/.test(getCharacterClassKey(character)) ? getWeaponMasteryTarget(character) : "";
    const weapons = character.gear.flatMap((item, index) => {
      const profile = getWeaponProfile(item);
      if (!profile || !canUseWeapon(character, item) || attackRequiresMissingAmmo(character, item.name)) return [];
      const damage = profile.versatileDamage || item.damage || item.damageExpression || profile.damage;
      return [{ index, ability: profile.ability, ranged: Boolean(profile.ammo || profile.thrown),
        mastered: mastery === profile.key, maxDamage: getMaximumDamage(damage) || getMaximumDamage(profile.damage) }];
    });
    equipImportLoadout(character, { needsLight, weapons, shieldAllowed: canUseShield(character), lanternFueled: characterHasOil(character) });
    syncCharacterEquipmentDerivedStats(character);
  }
  if (character.lightRadius > 0) {
    if (firstLight || state.timers.torchElapsedMs >= state.timers.torchDurationMs) lightNewTorch(state);
    return;
  }
  // Loading a saved character must not replace the player's saved hand choices.
  if (!chooseLoadout || (!firstLight && !isCharacterInLiveLight(character))) return;
  const index = character.gear.findIndex(item => item.equipped && getGearLightSource(item));
  if (index < 0) return;
  const source = getGearLightSource(character.gear[index]);
  if (!hasLiveTimedLight(state) || firstLight || state.timers.torchElapsedMs >= state.timers.torchDurationMs) lightNewTorch(state);
  setCharacterLight(character, source, index);
  if (source === "lantern") removeOneOil(character);
}

function syncPlayerLightFromActiveCharacter() {
  const active = getActiveCharacter(state);
  if (active?.equipmentInitialized) syncEquipmentLight(active);
  const radius = Number(active?.lightRadius) || 0;
  state.player.lightSource = active?.lightSource || "";
  state.player.lightRadius = radius || DEFAULT_LIGHT_RADIUS;
  state.player.torchLit = radius > 0;
}

function syncActiveCharacterLightFromPlayer() {
  const active = getActiveCharacter(state);
  if (!active) {
    return;
  }
  if (!state.player.torchLit) {
    if (state.player.lightSource === "lantern" && active.lightSource === "lantern") {
      hideCharacterLight(active);
      return;
    }
    setCharacterLight(active, "");
    return;
  }
  if (state.player.lightSource === "lantern") {
    setCharacterLight(active, "lantern");
    return;
  }
  if (state.player.lightSource === "light-spell") {
    setCharacterLight(active, "light-spell");
    return;
  }
  setCharacterLight(active, "torch");
}

function lightActiveCharacter(source, gearIndex = null) {
  const active = getActiveCharacter(state);
  lightNewTorch(state);
  state.player.lightSource = source === "lantern" ? "lantern" : source === "light-spell" ? "light-spell" : "torch";
  state.player.lightRadius = source === "lantern" ? 12 : DEFAULT_LIGHT_RADIUS;
  if (active) {
    setCharacterLight(active, state.player.lightSource, gearIndex);
    syncPlayerLightFromActiveCharacter();
  }
}

function setPlayerLightWithoutReset(source) {
  state.player.torchLit = true;
  state.player.lightSource = source === "lantern" ? "lantern" : source === "light-spell" ? "light-spell" : "torch";
  state.player.lightRadius = source === "lantern" ? 12 : DEFAULT_LIGHT_RADIUS;
}

function applyLightRequest(source, { extinguishOld = true, gearIndex = null } = {}) {
  const active = getActiveCharacter(state);
  const targetItem = active?.gear?.[gearIndex] || active?.gear?.find(item => !item.lit && getGearLightSource(item) === source);
  const wasHiddenLantern = source === "lantern" && active?.lightSource === "lantern" && active.lightHidden === true;
  if (extinguishOld) {
    resetBurningLights(state);
    lightActiveCharacter(source, targetItem ? active.gear.indexOf(targetItem) : null);
    state.lightTransition = { startedAt: Date.now(), characterId: active?.id };
  } else {
    const timers = ensureTimers(state);
    if (!timers.lightEverLit) lightNewTorch(state);
    else if (!hasLiveTimedLight(state)) timers.lastTickAt = Date.now();
    const oldTorches = (active?.gear || []).filter(item => item.equipped && handItemKind(item) === 'torch');
    setPlayerLightWithoutReset(source);
    if (active) {
      setCharacterLight(active, state.player.lightSource, targetItem ? active.gear.indexOf(targetItem) : gearIndex);
      releaseUnequippedTorches(active, oldTorches, item => state.entities.push(createDroppedGearEntity(item, active, item.lit ? 'torch' : '')), () => 1);
    }
  }
  if (source === "lantern" && !wasHiddenLantern) {
    removeOneOil(active);
  }
  normalizeCharacterState(state);
  applyCharacterAmmoOverrides();
  syncAllCharacterEquipmentDerivedStats();
  applyCharacterColorOverrides();
  ensureCharacterPresentation();
  markUserActivity();
  recomputeVisibility(state);
  const sighting = processMonsterVisibilityChange();
  if (!sighting?.combatStarted && !sighting?.combatEnded) {
    setStatus(source === "lantern"
      ? (wasHiddenLantern ? "Lantern uncovered." : "Lantern is lit!")
      : "New torch lit.");
  }
  markRunDirty();
  refreshOpenCharacterSheet(active);
  render();
  updatePanels();
}

function closeExtinguishOldModal() {
  pendingLightRequest = null;
  if (ui.extinguishOldModal) {
    ui.extinguishOldModal.hidden = true;
  }
}

function promptExtinguishOld(source, gearIndex = null) {
  pendingLightRequest = { source, gearIndex, characterId: state.activeCharacterId, round: state.combat?.round, turnIndex: state.combat?.turnIndex };
  if (!ui.extinguishOldModal) {
    applyLightRequest(source, { extinguishOld: true, gearIndex });
    return;
  }
  ui.extinguishOldModal.hidden = false;
}

function getLightAttemptFailure(source) {
  const active = getActiveCharacter(state);
  if (isFloatingDisc(active) && source !== 'lantern') return 'Floating Disc can equip only lanterns.';
  if (source === "lantern") {
    if (!characterHasLantern(active)) return "No lantern.";
    if (!characterHasOil(active)) return "No oil flask.";
  } else if (!characterHasTorch(active)) {
    return "No torch.";
  }
  if (ensureTimers(state).lightEverLit && !characterHasFlintAndSteel(inventoryController(active)) && !isCharacterInLiveLight(active)) {
    return "Need flint and steel or an existing light source.";
  }
  return "";
}

function attemptLightSource(source, gearIndex = null, { resetTimer = null } = {}) {
  const active = getActiveCharacter(state);
  const failure = getLightAttemptFailure(source);
  if (failure) {
    setStatus(failure);
    return;
  }
  if (resetTimer === null && ensureTimers(state).lightEverLit) { promptExtinguishOld(source, gearIndex); return; }
  if (sendSharedCommand("light", { source, gear_index: gearIndex, reset_timer: resetTimer === true })) return;
  if (!consumeCharacterCombatAction(active)) return;
  if (ensureTimers(state).lightEverLit && !isCharacterInLiveLight(active) && characterHasFlintAndSteel(inventoryController(active))) {
    const modifier = getCharacterActionModifier(inventoryController(active), "dex");
    const disadvantage = !isThief(inventoryController(active));
    const check = rollCheck(modifier, { disadvantage });
    if (check.total < 12) {
      setStatus(`Light ${check.total} vs DC 12: failed.`);
      return;
    }
    setStatus(`Light ${check.total} vs DC 12: success.`);
  }
  applyLightRequest(source, { extinguishOld: resetTimer === true, gearIndex });
}

function clearActiveCharacterLight() {
  forceTorchOut(state);
  state.player.lightSource = "";
  state.player.lightRadius = DEFAULT_LIGHT_RADIUS;
  syncActiveCharacterLightFromPlayer();
}

function snuffActiveTorch() {
  const active = getActiveCharacter(state);
  if (!active) {
    return false;
  }
  removeOneTorch(active);
  setCharacterLight(active, "");
  forceTorchOut(state);
  state.player.lightSource = "";
  state.player.lightRadius = DEFAULT_LIGHT_RADIUS;
  normalizeCharacterState(state);
  applyCharacterAmmoOverrides();
  syncAllCharacterEquipmentDerivedStats();
  applyCharacterColorOverrides();
  ensureCharacterPresentation();
  recomputeVisibility(state);
  markRunDirty();
  triggerPartyDoppelgangers();
  return true;
}

function extinguishTimedPartyLights() {
  for (const character of state.characters || []) {
    for (const item of [...(character.gear || [])]) {
      if (!item.lit || !getGearLightSource(item)) continue;
      item.lit = false;
      if (getGearLightSource(item) === "torch") {
        const units = getGearUnits(item);
        if (units > 1) setGearItemUnits(item, units - 1);
        else character.gear.splice(character.gear.indexOf(item), 1);
      }
    }
    character.lightSpellLit = false;
    syncEquipmentLight(character);
  }
  for (const entity of state.entities || []) {
    if (
      entity.subtype === "dropped-equipment" &&
      entity.collected !== true &&
      (entity.lightSource === "torch" || entity.lightSource === "lantern")
    ) {
      delete entity.lightSource;
      delete entity.lightRadius;
      if (entity.gearItem) entity.gearItem.lit = false;
    }
  }
  forceTorchOut(state);
  state.player.lightSource = "";
  state.player.lightRadius = DEFAULT_LIGHT_RADIUS;
  normalizeCharacterState(state);
  syncAllCharacterEquipmentDerivedStats();
  syncPlayerLightFromActiveCharacter();
  recomputeVisibility(state);
  markRunDirty();
}

function extinguishActiveLantern() {
  const active = getActiveCharacter(state);
  if (!active) {
    return false;
  }
  setCharacterLight(active, "");
  forceTorchOut(state);
  state.player.lightSource = "";
  state.player.lightRadius = DEFAULT_LIGHT_RADIUS;
  recomputeVisibility(state);
  markRunDirty();
  return true;
}

function hideActiveLantern() {
  const active = getActiveCharacter(state);
  if (!active || active.lightSource !== "lantern") {
    return false;
  }
  hideCharacterLight(active);
  forceTorchOut(state);
  state.player.lightSource = "lantern";
  state.player.lightRadius = 12;
  recomputeVisibility(state);
  markRunDirty();
  return true;
}

function revealActiveLantern() {
  const active = getActiveCharacter(state);
  if (!active || active.lightSource !== "lantern" || active.lightHidden !== true) {
    return false;
  }
  const item = active.gear.find(item => item.equipped && item.lit && getGearLightSource(item) === "lantern");
  if (item) item.covered = false;
  syncEquipmentLight(active);
  if (active.id === state.activeCharacterId) {
    syncPlayerLightFromActiveCharacter();
  }
  recomputeVisibility(state);
  markRunDirty();
  return true;
}

function hasAnyVisibleLightSource() {
  return Boolean(state && collectLightSources(state).length);
}

function expireActiveLightFromTimer() {
  triggerPartyDoppelgangers();
  const active = getActiveCharacter(state);
  const source = active?.lightSource || state.player.lightSource || "torch";
  if (source === "torch") {
    extinguishTimedPartyLights();
    return "Torch snuffed!";
  }
  if (source === "lantern") {
    extinguishTimedPartyLights();
    return "Lantern went out!";
  }
  if (source === "light-spell") {
    extinguishTimedPartyLights();
    return "Light spell faded.";
  }
  clearActiveCharacterLight();
  return "Light went out!";
}

function getGearDisplayName(item) {
  const name = String(item?.name || "Gear").trim() || "Gear";
  const units = Number.isFinite(Number(item?.totalUnits)) && Number(item.totalUnits) > 0
    ? Math.floor(Number(item.totalUnits))
    : Number.isFinite(Number(item?.quantity)) && Number(item.quantity) > 0
      ? Math.floor(Number(item.quantity))
      : 1;
  return units > 1 ? `${name} x${units}` : name;
}

function isLightGearItem(item, source = "") {
  const name = String(item?.name || "").toLowerCase();
  if (source === "torch") {
    return /^torch\b/.test(name);
  }
  if (source === "lantern") {
    return /\blantern\b/.test(name);
  }
  return /^torch\b/.test(name) || /\blantern\b/.test(name);
}

function getGearLightSource(item) {
  const name = String(item?.name || "").toLowerCase();
  if (/^torch\b/.test(name)) {
    return "torch";
  }
  if (/\blantern\b/.test(name)) {
    return "lantern";
  }
  return "";
}

function markRunDirty() {
  if (state?.run) {
    state.run.dirty = true;
  }
}

function findEquipmentDropTile(character) {
  if (hasCharacterMapPosition(character)) {
    return {
      x: Number(character.x),
      y: Number(character.y),
      routeId: routeOf(state, character),
      roomId: character.roomId ?? getTileAt(Number(character.x), Number(character.y))?.roomId ?? null
    };
  }
  const origin = hasCharacterMapPosition(character)
    ? { x: Number(character.x), y: Number(character.y) }
    : { x: Number(state.player.x), y: Number(state.player.y) };
  const occupied = new Set((state.characters || [])
    .filter((candidate) => candidate.id !== character?.id && hasCharacterMapPosition(candidate))
    .map((candidate) => `${candidate.x},${candidate.y}`));
  return findOpenCharacterTile(origin.x, origin.y, occupied);
}

function getPileUnits(item) {
  return Math.min(1000, Math.max(1, getGearUnits(item)));
}

function setGearItemUnits(item, units) {
  const nextUnits = Math.max(0, Math.floor(Number(units) || 0));
  if (Object.prototype.hasOwnProperty.call(item, "totalUnits")) {
    item.totalUnits = nextUnits;
  }
  item.quantity = nextUnits;
}

function removeOneGearUnit(character, matcher) {
  if (!character || !Array.isArray(character.gear)) {
    return null;
  }
  const index = character.gear.findIndex((item) => matcher(String(item?.name || "").toLowerCase(), item));
  if (index === -1) {
    return null;
  }
  const item = character.gear[index];
  if(item.bound)return {message:'This dagger cannot be dropped.'};
  const removedItem = JSON.parse(JSON.stringify(item));
  const units = getGearUnits(item);
  setGearItemUnits(removedItem, 1);
  if (units > 1) {
    setGearItemUnits(item, units - 1);
  } else {
    character.gear.splice(index, 1);
  }
  return removedItem;
}

function removeOneOil(character) {
  return removeOneGearUnit(character, (name) => /\boil\b/.test(name));
}

function removeOneTorch(character) {
  const lit = character?.gear?.find(item => item.equipped && item.lit && getGearLightSource(item) === "torch");
  if (lit) lit.lit = false;
  return removeOneGearUnit(character, (name, item) => lit ? item === lit : /^torch\b/.test(name));
}

function getLitGearIndex(character, source = character?.lightSource) {
  if (!character || !source || !Array.isArray(character.gear)) {
    return -1;
  }
  return character.gear.findIndex(item => item.lit && item.equipped && getGearLightSource(item) === source);
}

function updateCharacterAmmoFromGearItem(character, item) {
  const ammoType = getGearAmmoType(item);
  if (!ammoType) {
    return;
  }
  const total = (Array.isArray(character?.gear) ? character.gear : [])
    .filter((candidate) => getGearAmmoType(candidate) === ammoType)
    .reduce((sum, candidate) => sum + getGearUnits(candidate), 0);
  setCharacterAmmo(character, ammoType, total);
  const key = getCharacterAmmoOverrideKey(character, ammoType);
  if (key) {
    characterAmmoOverrides.set(key, total);
  }
}

function findExistingGearStack(character, item) {
  const groupSize = getStackGroupSize(item?.name);
  if (groupSize <= 1) {
    return null;
  }
  const name = String(item?.name || "").toLowerCase();
  return (character.gear || []).find((candidate) => String(candidate?.name || "").toLowerCase() === name &&
    JSON.stringify(candidate.magic || null) === JSON.stringify(item.magic || null)) || null;
}

function getPickupSlotCost(character, item) {
  const groupSize = getStackGroupSize(item?.name);
  const units = getPileUnits(item);
  if (groupSize <= 1) {
    return units * inferGearItemSlots(item?.name, item);
  }
  const existing = findExistingGearStack(character, item);
  const currentUnits = existing ? getGearUnits(existing) : 0;
  return Math.max(0, Math.ceil((currentUnits + units) / groupSize) - Math.ceil(currentUnits / groupSize));
}

function findMergeableDroppedPile(item, tile) {
  if (!isEquipmentPileStackable(item?.name)) {
    return null;
  }
  const name = String(item?.name || "").toLowerCase();
  return state.entities.find((entity) => (
    entity.subtype === "dropped-equipment" &&
    sameRoute(state, entity, tile) &&
    !entity.collected &&
    entity.x === tile.x &&
    entity.y === tile.y &&
    String(entity.gearItem?.name || "").toLowerCase() === name &&
    isEquipmentPileStackable(entity.gearItem?.name) &&
    getGearUnits(entity.gearItem) < getStackGroupSize(entity.gearItem?.name)
  )) || null;
}

function createDroppedGearEntity(item, tile, litSource = "") {
  const units = getPileUnits(item);
  const droppedItem = JSON.parse(JSON.stringify(item));
  setGearItemUnits(droppedItem, units);
  const corpseLoot = droppedItem.corpseLoot === true;
  const worthlessLoot = droppedItem.worthlessLoot === true || corpseLoot;
  const entity = {
    id: `gear-drop-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
    type: "treasure",
    subtype: "dropped-equipment",
    kind: "equipment",
    name: getGearDisplayName(droppedItem),
    x: tile.x,
    y: tile.y,
    routeId: routeOf(state, tile),
    roomId: tile.roomId,
    hallId: tile.hallId || null,
    visible: true,
    revealed: true,
    collected: false,
    value: 0,
    slots: Math.max(1, Math.ceil(units / getStackGroupSize(droppedItem.name))),
    bonusSlots: 0,
    priceless: false,
    description: "Dropped equipment.",
    gearItem: droppedItem,
    worthlessLoot,
    corpseLoot,
    monsterName: droppedItem.monsterName || ""
  };
  if (litSource === "torch" || litSource === "lantern") {
    entity.lightSource = litSource;
    entity.lightRadius = litSource === "lantern" ? 12 : DEFAULT_LIGHT_RADIUS;
  }
  return entity;
}

function addDroppedGearPile(item, tile, litSource = "") {
  const groupSize = getStackGroupSize(item?.name);
  const mergeable = isEquipmentPileStackable(item?.name) ? findMergeableDroppedPile(item, tile) : null;
  if (mergeable) {
    const nextUnits = Math.min(groupSize, getGearUnits(mergeable.gearItem) + getPileUnits(item));
    setGearItemUnits(mergeable.gearItem, nextUnits);
    mergeable.name = getGearDisplayName(mergeable.gearItem);
    mergeable.slots = Math.max(1, Math.ceil(nextUnits / groupSize));
    if (litSource === "torch" || litSource === "lantern") {
      mergeable.lightSource = litSource;
      mergeable.lightRadius = litSource === "lantern" ? 12 : DEFAULT_LIGHT_RADIUS;
    }
    return mergeable;
  }
  const entity = createDroppedGearEntity(item, tile, litSource);
  state.entities.push(entity);
  return entity;
}

function dropCharacterGear(character, gearIndex) {
  if (sendSharedCommand("drop_gear", { gear_index: gearIndex }, character)) return { message: "Item drop submitted." };
  if (isFloatingDisc(character) && !SERVER_RUNTIME && !consumeCharacterCombatAction(character)) return { message: ui.statusText.textContent };
  if (!character || !Array.isArray(character.gear)) {
    return { message: "No character gear to drop." };
  }
  const index = Number.parseInt(gearIndex, 10);
  if (!Number.isInteger(index) || index < 0 || index >= character.gear.length) {
    return { message: "Gear item not found." };
  }
  const item = character.gear[index];
  const itemName = String(item?.name || "Gear").trim() || "Gear";
  const originalUnits = getGearUnits(item);
  const droppedItem = JSON.parse(JSON.stringify(item));
  const dropsOneUnitAtATime = originalUnits > 1;
  const litSource = item.lit ? getGearLightSource(item) : "";
  item.lit = false;
  item.equipped = false;
  droppedItem.equipped = false;
  droppedItem.covered = false;
  const dropUnits = dropsOneUnitAtATime ? 1 : Math.max(1, originalUnits);
  if (dropsOneUnitAtATime) {
    setGearItemUnits(item, originalUnits - 1);
  } else {
    character.gear.splice(index, 1);
  }
  setGearItemUnits(droppedItem, dropUnits);
  if (litSource) {
    syncEquipmentLight(character);
    syncPlayerLightFromActiveCharacter();
  }
  const tile = findEquipmentDropTile(character);
  addDroppedGearPile(droppedItem, tile, litSource);
  updateCharacterAmmoFromGearItem(character, droppedItem);
  normalizeCharacterState(state);
  syncAllCharacterEquipmentDerivedStats();
  applyCharacterColorOverrides();
  ensureCharacterPresentation();
  syncPlayerLightFromActiveCharacter();
  recomputeVisibility(state);
  markRunDirty();
  return { message: `${character.name || "Character"} drops ${getGearDisplayName(droppedItem)}.` };
}

function pickupDroppedEquipment(entity) {
  if (sendSharedCommand("pickup", { entity_id: entity?.id })) return { message: "Pickup submitted." };
  const character = getActiveCharacter(state);
  if (!partyCanReachLoot(state, entity)) return { message: 'Move a party member beside this item to pick it up.' };
  if (!character) {
    return { message: "Select a character to pick up equipment." };
  }
  const item = entity?.gearItem;
  if (!item) {
    return { message: "Dropped equipment is missing item data." };
  }
  const itemSlots = getPickupSlotCost(character, item);
  if (getCharacterGearFreeSlots(character) < itemSlots) {
    return { noFreeSlots: true, message: "No free slots." };
  }
  character.gear = Array.isArray(character.gear) ? character.gear : [];
  const existing = findExistingGearStack(character, item);
  let carriedItem = existing;
  if (existing) {
    setGearItemUnits(existing, getGearUnits(existing) + getPileUnits(item));
  } else {
    const pickupItem = JSON.parse(JSON.stringify(item));
    setGearItemUnits(pickupItem, getPileUnits(item));
    character.gear.push(pickupItem);
    carriedItem = pickupItem;
  }
  const pickedUpLightSource = entity.lightSource === "torch" || entity.lightSource === "lantern" ? entity.lightSource : "";
  if (pickedUpLightSource) {
    carriedItem.lit = true;
    carriedItem.covered = false;
    equipItem(character, character.gear.indexOf(carriedItem), true);
    if (character.id === state.activeCharacterId) {
      syncPlayerLightFromActiveCharacter();
    }
  }
  updateCharacterAmmoFromGearItem(character, item);
  entity.collected = true;
  delete entity.lightSource;
  delete entity.lightRadius;
  normalizeCharacterState(state);
  syncAllCharacterEquipmentDerivedStats();
  applyCharacterColorOverrides();
  ensureCharacterPresentation();
  syncPlayerLightFromActiveCharacter();
  recomputeVisibility(state);
  markRunDirty();
  return { message: `${character.name || "Character"} picks up ${getGearDisplayName(item)}.` };
}

function collectForFloatingDisc(loot) {
  const disc = getActiveCharacter(state);
  if (!loot || !isFloatingDisc(disc)) return;
  if (sendSharedCommand('pickup', { entity_id: loot.id }, disc)) return;
  if (!canControlCharacter(disc) || !canUseCharacterInventory(disc) || !SERVER_RUNTIME && !consumeCharacterCombatAction(disc)) return;
  const result = loot.subtype === 'dropped-equipment' ? pickupDroppedEquipment(loot) : collectLoot(state, loot.id);
  normalizeCharacterState(state); syncAllCharacterEquipmentDerivedStats(); syncPlayerLightFromActiveCharacter();
  processMonsterVisibilityChange(); markUserActivity(); markRunDirty(); setStatus(result.message || result);
  refreshCharacterViews(getActiveCharacter(state)); updatePanels(); render();
}

function canLightLantern(character) {
  if (!characterHasLantern(character)) {
    return false;
  }
  if (character?.lightSource === "lantern" && character.lightHidden === true) {
    return false;
  }
  return characterHasOil(character) && (!ensureTimers(state).lightEverLit || characterHasFlintAndSteel(inventoryController(character)) || isCharacterInLiveLight(character));
}

function canLightTorch(character) {
  if (isFloatingDisc(character)) return false;
  const torchUnits = getCharacterGearUnitsByMatcher(character, (name) => /^torch\b/.test(name));
  const litTorchUnits = (character?.gear || []).filter(item => item.lit && getGearLightSource(item) === "torch").length;
  return torchUnits > litTorchUnits && (!ensureTimers(state).lightEverLit || characterHasFlintAndSteel(character) || isCharacterInLiveLight(character));
}

function getCharacterMapPosition(character) {
  if (!character) {
    return null;
  }
  const x = Number.isFinite(Number(character.x)) ? Number(character.x) : Number(state?.player?.x);
  const y = Number.isFinite(Number(character.y)) ? Number(character.y) : Number(state?.player?.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return null;
  }
  return { x, y };
}

function isPointInLightRadius(x, y, source) {
  const radius = Number(source?.radius ?? source?.lightRadius) || 0;
  if (radius <= 0 || !Number.isFinite(Number(source?.x)) || !Number.isFinite(Number(source?.y))) {
    return false;
  }
  return Math.hypot(Number(source.x) - x, Number(source.y) - y) <= radius;
}

function isCharacterInLiveLight(character) {
  const position = getCharacterMapPosition(character);
  if (!position || !state) {
    return false;
  }
  if (isLightSuppressedAt(state, position.x, position.y)) return false;
  return isTileIlluminated(state, position.x, position.y, character);
}

function getExplicitActiveCharacter(stateValue = state) {
  if (!stateValue?.activeCharacterId) {
    return null;
  }
  return stateValue.characters?.find((character) => character.id === stateValue.activeCharacterId) || null;
}

function characterHasLightSpell(character) {
  const text = [
    character?.spellsKnown || "",
    ...(Array.isArray(character?.levels) ? character.levels : []).map((level) => `${level?.talentRolledName || ""} ${level?.talentRolledDesc || ""}`),
    ...(Array.isArray(character?.bonuses) ? character.bonuses : []).map((bonus) => `${bonus?.bonusName || bonus?.name || ""} ${bonus?.bonusTo || ""}`)
  ].join(" ");
  return /\blight\b/i.test(text);
}

function canCastLightSpell(character) {
  return characterHasLightSpell(character) && !isCharacterSpellFailed(character, "Light");
}

function clearInvalidCharacterLight(character) {
  if (!character?.lightSource) {
    return;
  }
  if (character.lightSource === "torch" && !characterHasTorch(character)) {
    setCharacterLight(character, "");
  } else if (character.lightSource === "lantern" && !characterHasLantern(character)) {
    setCharacterLight(character, "");
  } else if (character.lightSource === "light-spell" && !characterHasLightSpell(character)) {
    setCharacterLight(character, "");
  }
}

function createLightSourceMarker(source) {
  const marker = document.createElement("span");
  marker.className = ["light-source-marker", `light-source-marker--${source || "torch"}`].join(" ");
  marker.setAttribute("aria-hidden", "true");
  return marker;
}

function createCharacterLightNote(character) {
  if (!character?.lightSource || !Number(character.lightRadius)) {
    return null;
  }
  const source = character.lightSource;
  const note = document.createElement("span");
  note.className = "character-light-note";
  const rangeText = source === "lantern" ? "2 x Near" : "Near";
  note.append(document.createTextNode(`${getLightSourceLabel(source)} (${rangeText}) `), createLightSourceMarker(source));
  return note;
}

function clearMagicLightIfIncapacitated(character) {
  if (!character || character.lightSource !== "light-spell" || Number(character.hp) > 0) {
    return;
  }
  setCharacterLight(character, "");
  if (state?.activeCharacterId === character.id) {
    syncPlayerLightFromActiveCharacter();
    recomputeVisibility(state);
  }
}

function getLightSourceLabel(source) {
  if (source === "lantern") {
    return "Lantern";
  }
  if (source === "light-spell") {
    return "Light Spell";
  }
  return "Torch";
}

function updateLightControlUi() {
  const active = getExplicitActiveCharacter(state);
  if (!active) {
    if (state?.characters?.length) {
      if (ui.torchOutBtn) ui.torchOutBtn.hidden = true;
      if (ui.lightTorchBtn) ui.lightTorchBtn.hidden = true;
      if (ui.lightLanternBtn) ui.lightLanternBtn.hidden = true;
      if (ui.castLightBtn) ui.castLightBtn.hidden = true;
      return;
    }
    if (ui.torchOutBtn) {
      ui.torchOutBtn.hidden = false;
      ui.torchOutBtn.textContent = "Torch snuffed!";
    }
    if (ui.lightTorchBtn) ui.lightTorchBtn.hidden = true;
    if (ui.lightLanternBtn) ui.lightLanternBtn.hidden = true;
    if (ui.castLightBtn) ui.castLightBtn.hidden = true;
    return;
  }
  clearInvalidCharacterLight(active);
  syncPlayerLightFromActiveCharacter();
  const activeSource = active?.lightSource || "";
  if (ui.lightTorchBtn) {
    ui.lightTorchBtn.hidden = !canLightTorch(active);
  }
  if (ui.lightLanternBtn) {
    ui.lightLanternBtn.hidden = !canLightLantern(active);
  }
  if (ui.castLightBtn) {
    ui.castLightBtn.hidden = !canCastLightSpell(active);
  }
  if (ui.torchOutBtn) {
    ui.torchOutBtn.hidden = !(activeSource === "torch" || activeSource === "lantern");
    ui.torchOutBtn.textContent = activeSource === "lantern" ? "Lantern went out!" : "Torch snuffed!";
  }
}

function formatTalentSpellTextForSheet(text) {
  return String(text || "")
    .replace(/^Thief\s+\d+:\s+Thief\s+\d+:\s+/i, "Thief 1: ")
    .replace(/^Fighter\s+(\d+):\s*([^:]+?)\s*$/i, (line, level, weapon) => {
      const profile = getWeaponProfileFromText(weapon);
      return profile && normalizeEquipmentName(weapon) === profile.key ? `Fighter ${level}: ${weapon} mastery` : line;
    })
    .replace(/^(\w+\s+\d+):\s*([^:]+):\s*(?:Weapon\s+)?Mastery\s*$/i, "$1: $2 mastery")
    .replace(/^Fighter\s+(\d+):\s*(?:Weapon\s+)?Mastery:\s*([^:]+?)\s*$/i, "Fighter $1: $2 mastery")
    .replace(/^Fighter\s+(\d+):\s*Armor Mastery:\s*Shield\s*$/i, "Fighter $1: Armor Mastery: +1 AC from Shields")
    .replace(/^Fighter\s+(\d+):\s*Armor Mastery:\s*(Leather(?: armor)?|Chainmail|Plate(?:mail| armor)?)\s*$/i, "Fighter $1: Armor Mastery: +1 AC from $2")
    .replace(/^(\w+\s+\d+):\s*Melee and ranged attacks\s*$/i, "$1: +1 to melee and ranged attacks")
    .replace(/^((?:Priest|Human Ambition)\s*\d*):\s*Ranged attacks\s*$/i, "$1: +1 to hit with Ranged")
    .replace(/^Elf:\s*Attack Bonus:\s*RangedWeapons\s*$/i, "Elf: +1 to hit with Ranged")
    .replace(/^(\w+\s+\d+):\s*([^:]+):\s*AdvOnCastOneSpell\s*$/i, "$1: Cast $2 at advantage")
    .replace(
      /\bBackstab Increase:\s*Your Backstab deals \+1 dice of damage\.?/gi,
      "Backstab Increase: +1 dice of damage."
    )
    .replace(/\bAdvantageOnStatChecks\b/g, "Advantage")
    .replace(
      /\bWizard spell,\s*roll\s+1d20\s*\+\s*\[?int mod\]?\s+vs\.?\s+a\s+DC\s+equal\s+to\s+10\s*\+\s*the\s+spell'?s\s+tier\.?/gi,
      "Wizard spell, 1d20+[int mod] DC = 10 + Tier."
    )
    .replace(
      /\bTo cast a Priest spell,\s*roll\s+1d20\s*\+\s*\[?wis mod\]?\s+vs\.?\s+a\s+DC\s+equal\s+to\s+10\s*\+\s*the\s+spell'?s\s+tier\.?/gi,
      "Priest spell, 1d20+[wis mod] DC = 10 + Tier."
    )
    .replace(
      /\bPriest spell,\s*roll\s+1d20\s*\+\s*\[?wis mod\]?\s+vs\.?\s+a\s+DC\s+equal\s+to\s+10\s*\+\s*the\s+spell'?s\s+tier\.?/gi,
      "Priest spell, 1d20+[wis mod] DC = 10 + Tier."
    );
}

function isSpellCheckText(text) {
  return /\b(?:wizard|priest)\s+spell\b/i.test(String(text || "")) && /\b1d20\b/i.test(String(text || ""));
}

function getCharacterKnownSpellNames(character) {
  if(character?.companion?.kind==='doppelganger')return [];
  return String(character?.spellsKnown || "")
    .split(/\s*,\s*/)
    .map((name) => name.trim())
    .map(name => getSpellKey(name) === 'protection from evil' ? protectionName(character) : name)
    .map(name => getSpellKey(name) === 'floating disc' ? 'Floating Disc' : name)
    .filter(name => name && !forgottenSpells(character).has(getSpellKey(name)));
}

function getRemappedMagicMissileAdvantageSpell(character) {
  const spells = getCharacterKnownSpellNames(character).filter((name) => getSpellKey(name) !== "magic missile");
  if (!spells.length) {
    return "";
  }
  const seed = String(character?.id || character?.name || "").split("").reduce((total, char) => total + char.charCodeAt(0), 0);
  return spells[seed % spells.length];
}

function isMagicMissileAdvantageTalentLine(line) {
  return /(?:gain advantage on casting\s+magic missile|magic missile:\s*advoncastonespell)/i.test(String(line || ""));
}

function shouldSuppressTalentLine(line, allLines) {
  const normalized = String(line || "").trim();
  if (/^Spells:\s*None\s*$/i.test(normalized)) {
    return true;
  }
  if (isMagicMissileAdvantageTalentLine(normalized)) {
    return true;
  }
  if (/Armor Mastery:\s*Choose one kind of armor/i.test(normalized)) {
    return allLines.some((candidate) => /Armor Mastery:\s*(?:Shield|Leather|Chainmail|Plate)/i.test(String(candidate || "")));
  }
  if (!/Backstab Increase\s*$/i.test(normalized)) {
  return false;
}
  const prefix = normalized.replace(/Backstab Increase\s*$/i, "Backstab Increase:");
  return allLines.some((candidate) => (
    candidate !== line &&
    String(candidate || "").startsWith(prefix) &&
    /\+1 dice of damage|Your Backstab deals/i.test(String(candidate || ""))
  ));
}

function buildTalentSpellLines(character) {
  const lines = [];
  const seenLines = new Set();
  const spellBuckets = {};
  const sourceEntries = new Map();
  const globalKnownSpells = new Set();
  const hasTopLevelLanguages = Boolean(normalizeName(character?.languages));

  function getSource(label) {
    const labelBase = normalizeName(label).replace(/\s+\d+$/u, "");
    if (!sourceEntries.has(label)) {
      sourceEntries.set(label, {
        learnByTier: new Map(),
        extraByDesc: new Map(),
        pendingExtraDesc: labelBase ? `Learn an additional ${labelBase} spell` : "Learn an additional spell",
        defaultSpellTier: "",
        simpleLines: []
      });
    }
    return sourceEntries.get(label);
  }

  function normalizeName(value) {
    return String(value || "").replace(/\s+/g, " ").replace(/^["']|["']$/g, "").trim();
  }

  function isNullText(value) {
    return /^\s*none\s*$/i.test(normalizeName(value));
  }

  function prettifyTalentName(value) {
    const normalized = normalizeName(value)
      .replace(/([a-z])([A-Z])/g, "$1 $2")
      .replace(/([0-9])([A-Za-z])/g, "$1 $2")
      .replace(/([A-Za-z])([0-9])/g, "$1 $2")
      .replace(/_/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    return normalized
      .split(" ")
      .map((word) => (/^[A-Z]{2,}$/i.test(word) ? word : `${word.charAt(0).toUpperCase()}${word.slice(1)}`))
      .filter(Boolean)
      .join(" ")
      .replace(/^Stat Bonus$/i, "Stat Bonus");
  }

  function normalizeTier(value) {
    const tier = String(value || "").trim();
    return tier ? tier : "";
  }

  function extractBonusSourceLabel(bonus) {
    const sourceName = normalizeName(bonus?.sourceName);
    const sourceType = normalizeName(bonus?.sourceType);
    const level = bonus?.gainedAtLevel || character.level || 1;
    const sourceTypeLower = sourceType.toLowerCase();

    if (sourceTypeLower === "class") {
      return `${sourceName || character.className || "Class"} ${level}`.trim();
    }
    if (sourceTypeLower === "ancestry") {
      return `${sourceName || character.ancestry || "Ancestry"}`.trim();
    }
    if (sourceTypeLower === "ambition") {
      return `${sourceName || character.ancestry || "Ancestry"} Ambition Talent`;
    }
    if (sourceName && sourceType && sourceTypeLower !== "talent") {
      if (sourceTypeLower.includes("ambition")) {
        return `${sourceName} ${sourceType}`.replace(/\bAmbition$/i, "Ambition Talent").trim();
      }
      return `${sourceName} ${sourceType}`.trim();
    }
    return `${sourceName || sourceType || "Talent"} ${sourceTypeLower === "talent" ? "" : level}`.trim();
  }

  function sanitizeSpell(value) {
    return normalizeName(value)
      .replace(/^\((.*?)\)$/, "$1")
      .replace(/^\[(.*?)\]$/, "$1")
      .replace(/^(?:-|\u2014)\s*/, "")
      .replace(/\s+(?:\(V\)|\(M\)|\(S\))$/i, "")
      .trim();
  }

  function looksLikeSpell(value) {
    const normalized = normalizeName(value);
    if (!normalized) {
      return false;
    }
    if (normalized.length > 70) {
      return false;
    }
    if (/^\d+$/.test(normalized)) {
      return false;
    }
    if (/learn\s+an\s+additional|learnextra|pickextraspell|spell(?:s)?\s*$/i.test(normalized)) {
      return false;
    }
    return true;
  }

  function extractExtraDescription(value) {
    const sourceText = normalizeName(value);
    const learnExtraMatch = sourceText.match(/\blearn\s+an\s+additional\s+(.+?\bspell)\b/i);
    if (learnExtraMatch && learnExtraMatch[1]) {
      const compact = normalizeName(`Learn an additional ${learnExtraMatch[1]}`);
      if (compact) {
        return compact;
      }
    }
    return "";
  }

  function ensureBucket(map, tier) {
    const tierKey = normalizeTier(tier);
    if (!map.has(tierKey)) {
      map.set(tierKey, []);
    }
    return map.get(tierKey);
  }

  function addSpellToBucket(map, name, tier) {
    const spell = sanitizeSpell(name);
    if (!spell || !looksLikeSpell(spell)) {
      return;
    }
    const bucket = ensureBucket(map, tier);
    const key = spell.toLowerCase();
    const already = bucket.some((item) => item.toLowerCase() === key);
    if (!already) {
      bucket.push(spell);
    }
  }

  function readSpellsForDisplay(spellsByTier) {
    const output = [];
    const sorted = Array.from(spellsByTier.entries()).sort((a, b) => {
      if (!a[0] && b[0]) {
        return 1;
      }
      if (a[0] && !b[0]) {
        return -1;
      }
      const aNum = Number(a[0]);
      const bNum = Number(b[0]);
      if (Number.isFinite(aNum) && Number.isFinite(bNum)) {
        return aNum - bNum;
      }
      return a[0].localeCompare(b[0]);
    });
    for (const [tier, spells] of sorted) {
      for (const spell of spells) {
        output.push({ tier, name: spell });
      }
    }
    return output;
  }

  function addExtraGroup(source, desc, name, tier) {
    const groupKey = normalizeName(desc || "Learn an additional spell");
    const group = source.extraByDesc.get(groupKey) || {
      desc: groupKey,
      spellsByTier: new Map()
    };
    addSpellToBucket(group.spellsByTier, name, tier);
    source.extraByDesc.set(groupKey, group);
  }

  function addLine(line) {
    const value = String(line || "").trim();
    if (!value) {
      return;
    }
    const key = value.toLowerCase();
    if (seenLines.has(key)) {
      return;
    }
    seenLines.add(key);
    lines.push(value);
  }

  function hasGlobalSpellAnyTier(name) {
    const lower = sanitizeSpell(name).toLowerCase();
    return Object.values(spellBuckets).some((bucket) => (
      bucket.some((entry) => entry.toLowerCase() === lower)
    ));
  }

  function sameTalentText(name, detail) {
    const cleanName = prettifyTalentName(name).replace(/\s+/g, "").toLowerCase();
    const cleanDetail = prettifyTalentName(detail).replace(/\s+/g, "").toLowerCase();
    return cleanName && cleanName === cleanDetail;
  }

  function isChoiceText(name, detail) {
    const text = normalizeName(`${name} ${detail}`);
    return /\bor\b/i.test(text) && /\bplus\s*\d|\+\d/i.test(text);
  }

  function getCastingTarget(detail, learnedSpells) {
    if (learnedSpells.length) {
      return learnedSpells[0];
    }
    const castMatch = normalizeName(detail).match(/\bcasting\s+([A-Za-z][A-Za-z0-9' -]+)/i);
    return castMatch ? castMatch[1] : "";
  }

  function parseLearnSpells(source, sourceText) {
    const getBucketCount = (map) => Array.from(map.values()).reduce((count, list) => count + list.length, 0);
    const knownCount = getBucketCount(source.learnByTier);
    let text = sourceText;
    const addLearnSpell = (name, tier) => {
      const tierValue = normalizeTier(tier);
      if (!source.defaultSpellTier && tierValue) {
        source.defaultSpellTier = tierValue;
      }
      addSpellToBucket(source.learnByTier, name, tierValue);
    };

    const learnByNamePattern = /\b([A-Za-z][A-Za-z0-9' -]+?)\s*:\s*Tier:\s*([0-9]+)\s*,\s*Spell\b[^;,]*/gi;
    text = text.replace(learnByNamePattern, (match, name, tier) => {
      addLearnSpell(name, tier);
      return " ";
    });

    const learnByNameNoColonPattern = /\b([A-Za-z][A-Za-z0-9' -]+?)\s+Tier:\s*([0-9]+)\s*,\s*Spell\b/gi;
    text = text.replace(learnByNameNoColonPattern, (match, name, tier) => {
      addLearnSpell(name, tier);
      return " ";
    });

    const learnBySpellPattern = /\bSpell\s*\d*\s*:\s*([^,;()-]+)(?:\s*-\s*Tier\s*:\s*([0-9]+))?/gi;
    text = text.replace(learnBySpellPattern, (match, spellName, tier) => {
      const tierValue = normalizeTier(tier);
      if (!source.defaultSpellTier && tierValue) {
        source.defaultSpellTier = tierValue;
      }
      addSpellToBucket(source.learnByTier, spellName, tier);
      return " ";
    });

    const learnListPattern = /\blearn\s*:\s*([^;]+)/i;
    text = text.replace(learnListPattern, (match, listText) => {
      const spellNames = normalizeName(listText).split(",").map((entry) => sanitizeSpell(entry)).filter(Boolean);
      for (const spellName of spellNames) {
        addSpellToBucket(source.learnByTier, spellName, "");
      }
      return " ";
    });

    const learnTierOnlyPattern = /\b([A-Za-z][A-Za-z0-9' -]+?)\s*:\s*Tier:\s*([0-9]+)(?!\s*,\s*Spell)/gi;
    text = text.replace(learnTierOnlyPattern, (match, name, tier) => {
      addLearnSpell(name, tier);
      return " ";
    });

    return {
      parsedText: text.trim(),
      foundSpells: getBucketCount(source.learnByTier) > knownCount
    };
  }

  function toSpellList(value) {
    const list = normalizeName(value)
      .split(",")
      .map((entry) => sanitizeSpell(entry))
      .filter(Boolean)
      .filter(looksLikeSpell);
    return list;
  }

    function collectExtraSpells(label, source, sourceText) {
    const text = normalizeName(sourceText);
    if (!text) {
      return false;
    }

    const tierMatch = text.match(/Tier:\s*([0-9]+)/i);
    const tier = tierMatch ? tierMatch[1] : "";

    const extraKeywordPresent = /(Learn\s*Extra\s*Spell|LearnExtraSpell|PickExtraSpell)/i.test(text);
    const extraDescMatch = text.match(/\blearn\s+an\s+additional[^:;]*/i);

    if (!extraKeywordPresent && !extraDescMatch) {
      return false;
    }

    let markerMatch = text.match(/Learn\s*Extra\s*Spell|LearnExtraSpell|PickExtraSpell/i);
    const marker = markerMatch ? markerMatch[0] : "";
    const markerStart = markerMatch ? markerMatch.index : -1;
    const markerEnd = markerMatch ? markerStart + marker.length : -1;

    const beforeMarker = normalizeName(markerMatch ? text.slice(0, markerStart) : text);
    const afterMarker = normalizeName(markerMatch ? text.slice(markerEnd) : "");

    const descriptionCandidate = normalizeName(
      extractExtraDescription(beforeMarker) || extractExtraDescription(afterMarker) || source.pendingExtraDesc || "Learn an additional spell"
    );
    if (descriptionCandidate) {
      source.pendingExtraDesc = descriptionCandidate;
    }

    const beforeSpells = toSpellList(beforeMarker);
    const afterSpells = toSpellList(afterMarker);
    let spellNames = [...afterSpells];
    if (!spellNames.length) {
      spellNames = [...beforeSpells];
    }
    if (!spellNames.length && extraDescMatch) {
      source.pendingExtraDesc = extractExtraDescription(extraDescMatch[0]) || source.pendingExtraDesc;
      source.extraByDesc.set(source.pendingExtraDesc, {
        desc: source.pendingExtraDesc,
        spellsByTier: new Map()
      });
      return true;
    }

    if (!spellNames.length) {
      return false;
    }

    const effectiveTier = tier || source.defaultSpellTier || "";
    for (const spellName of spellNames) {
      addExtraGroup(source, source.pendingExtraDesc || "Learn an additional spell", spellName, effectiveTier);
    }
    return true;
  }

  function addSourceLanguageLine(characterLanguages) {
    if (!characterLanguages) {
      return;
    }
    addLine(`Languages: ${characterLanguages}`);
  }

  function addSourceFromKnownSpells(knownSpells) {
    for (const spell of knownSpells) {
      if (isNullText(spell)) {
        continue;
      }
      const cleaned = sanitizeSpell(spell);
      if (!looksLikeSpell(cleaned)) {
        continue;
      }
      if (globalKnownSpells.has(cleaned.toLowerCase())) {
        continue;
      }
      if (hasGlobalSpellAnyTier(cleaned)) {
        continue;
      }
      globalKnownSpells.add(cleaned.toLowerCase());
      addGlobalSpell(cleaned, findSpellRecord(cleaned)?.tier || 1);
    }
  }

  function addGlobalSpell(name, tier) {
    const spell = sanitizeSpell(name);
    if (!spell || !looksLikeSpell(spell)) {
      return;
    }
    const key = normalizeTier(tier || findSpellRecord(spell)?.tier || 1);
    const bucket = spellBuckets[key] || [];
    const lower = spell.toLowerCase();
    const exists = bucket.some((entry) => entry.toLowerCase() === lower);
    if (exists) {
      return;
    }
    if (!spellBuckets[key]) {
      spellBuckets[key] = [];
    }
    spellBuckets[key].push(spell);
  }

  function addSourceLines() {
    for (const [label, source] of sourceEntries) {
      const learnSpells = readSpellsForDisplay(source.learnByTier);
      if (learnSpells.length) {
        const names = [];
        for (const entry of learnSpells) {
          if (!names.includes(entry.name)) {
            names.push(entry.name);
          }
        }
        addLine(`${label}: Learn: ${names.join(", ")}`);
      }

      for (const extra of source.extraByDesc.values()) {
        const extras = readSpellsForDisplay(extra.spellsByTier);
        if (!extras.length) {
          continue;
        }
        const spellNames = extras.map((entry) => entry.name);
        if (spellNames.length) {
          const extraDesc = normalizeName(extra.desc) || "Learn an additional spell";
          if (isNullText(extraDesc)) {
            addLine(`${label}: Learn Extra Spell: ${spellNames.join(", ")}`);
          } else {
            addLine(`${label}: Learn Extra Spell: ${extraDesc}: ${spellNames.join(", ")}`);
          }
        }
      }

      for (const simple of source.simpleLines) {
        const talentName = String(simple?.name || "").trim();
        const detail = String(simple?.desc || "").trim();
        const nameLower = talentName.toLowerCase();
        const detailLower = detail.toLowerCase();
        const learnedSpells = readSpellsForDisplay(source.learnByTier).map((entry) => entry.name);

        if (/^languages$/i.test(nameLower) || /^languages$/i.test(detailLower)) {
          continue;
        }
        if (hasTopLevelLanguages && /languages/i.test(nameLower)) {
          continue;
        }
        if (hasTopLevelLanguages && /^languages\b/i.test(detailLower)) {
          continue;
        }
        if (hasTopLevelLanguages && /:\s*languages\b/i.test(detailLower)) {
          continue;
        }

        const isStatBonusGeneric = nameLower === "statbonus" || detailLower.startsWith("statbonus:");
        if (isStatBonusGeneric && /to\s+/.test(detailLower)) {
          const abilities = detailLower.match(/\b(str|strength|dex|dexterity|con|constitution|int|intelligence|wis|wisdom|cha|charisma)\b/g) || [];
          if (abilities.length >= 2) {
            continue;
          }
          continue;
        }
        if (nameLower === "talent" && !detail) {
          continue;
        }
        if (isChoiceText(talentName, detail)) {
          continue;
        }
        if (/^advantage/i.test(nameLower) || /adv on cast one spell|adv on cast/i.test(nameLower)) {
          if (/casting/i.test(detailLower) && /spell/i.test(detailLower)) {
            const castTarget = normalizeName(getCastingTarget(detail, learnedSpells));
            addLine(`${label}: Gain advantage on casting${castTarget ? ` ${castTarget}` : ""}`);
            continue;
          }
        }
        if (nameLower === "spellcasting") {
          const bonusMatch = detail.match(/[+-]?\d+/);
          if (bonusMatch) {
            const bonusValue = bonusMatch[0].startsWith("-") || bonusMatch[0].startsWith("+")
              ? bonusMatch[0]
              : `+${bonusMatch[0]}`;
            addLine(`${label}: Spellcasting${bonusValue}`);
            continue;
          }
          addLine(`${label}: Spellcasting${detail ? `: ${detail}` : ""}`);
          continue;
        }
        if (nameLower && detailLower === "") {
          if (nameLower.startsWith("learn an additional spell")) {
            const extraDesc = normalizeName(nameLower.replace(/\blearn an additional spell\b/i, "Learn an additional spell"));
            addLine(`${label}: Learn Extra Spell: ${extraDesc}`);
            continue;
          }
          if (nameLower === "learn") {
            continue;
          }
        }
        if (/^plus\s+\d/i.test(talentName) && !detail) {
          continue;
        }

        if (!nameLower && detail) {
          addLine(`${label}: ${detail}`);
          continue;
        }
        if (nameLower === "stat bonus" || nameLower === "statbonus") {
          const displayLabel = label.replace(/\bAmbition$/i, "Ambition Talent");
          addLine(`${displayLabel}: Stat Bonus${detail ? `: ${detail}` : ""}`);
          continue;
        }
        if (talentName && detail) {
          if (sameTalentText(talentName, detail)) {
            addLine(`${label}: ${prettifyTalentName(talentName)}`);
          } else if (/^plus\s+\d/i.test(talentName)) {
            addLine(`${label}: ${detail}`);
          } else {
            addLine(`${label}: ${prettifyTalentName(talentName)}: ${detail}`);
          }
          continue;
        }
        if (talentName) {
          addLine(`${label}: ${prettifyTalentName(talentName)}`);
        }
      }
    }
  }

  function parseTalentLine(label, talentName, talentDesc) {
    const source = getSource(label);
    const parsedName = normalizeName(talentName);
    const parsedDesc = normalizeName(talentDesc);
    const normalizedTalentName = /^spells?$/i.test(parsedName) ? "" : parsedName;
    const normalizedTalentDesc = parsedDesc;
    const talentText = normalizeName(`${normalizedTalentName} ${normalizedTalentDesc}`.trim());
    if (!talentText) {
      return false;
    }

    const parsed = parseLearnSpells(source, talentText);
    const extrasFound = collectExtraSpells(label, source, parsed.parsedText);

    const introPhrase = parsed.parsedText.match(/\blearn\s+an\s+additional\s+.+?\bspell\b/i);
    if (introPhrase) {
      const description = extractExtraDescription(introPhrase[0]);
      if (description) {
        source.pendingExtraDesc = description;
      }
      return true;
    }

    if (!parsed.foundSpells && !extrasFound && talentName) {
      source.simpleLines.push({
        name: normalizeName(prettifyTalentName(normalizedTalentName)),
        desc: normalizedTalentDesc
      });
    }
    return parsed.foundSpells || extrasFound || Boolean(talentName && talentText);
  }

  addSourceLanguageLine(character.languages);

  const className = character.className || "Class";
  for (const level of character.levels || []) {
    if (level.progression) continue;
    const levelNumber = level?.level || character.level || 1;
    const sourceLabel = `${className} ${levelNumber}`;
    if (!parseTalentLine(sourceLabel, level?.talentRolledName || "", level?.talentRolledDesc || "")) {
      parseTalentLine(sourceLabel, "Talent", level?.talentRolledDesc || "");
    }
  }

  for (const bonus of character.bonuses || []) {
    if (bonus.progression) {
      if (!String(bonus.name).startsWith('Spell:')) addLine(`${bonus.sourceName} ${bonus.gainedAtLevel}: ${bonus.description}`);
      continue;
    }
    const sourceLabel = extractBonusSourceLabel(bonus);
    const sourceName = bonus?.bonusName || bonus?.name || "";
    const bonusDetail = bonus?.bonusTo || "";
    if (!parseTalentLine(sourceLabel, sourceName, bonusDetail)) {
      parseTalentLine(sourceLabel, "Talent", [sourceName, bonusDetail].filter(Boolean).join(" "));
    }
  }

  addSourceLines();

  for (const source of sourceEntries.values()) {
    for (const [tier, entry] of source.learnByTier.entries()) {
      for (const name of entry) {
        addGlobalSpell(name, tier);
      }
    }
    for (const extra of source.extraByDesc.values()) {
      for (const [tier, entry] of extra.spellsByTier.entries()) {
        for (const name of entry) {
          addGlobalSpell(name, tier);
        }
      }
    }
  }

  const knownSpells = typeof character?.spellsKnown === "string" ? character.spellsKnown.split(",").map((entry) => entry.trim()).filter(Boolean) : [];
  addSourceFromKnownSpells(knownSpells);

  const sortedTiers = Object.keys(spellBuckets).sort((a, b) => {
    if (!a) {
      return 1;
    }
    if (!b) {
      return -1;
    }
    return Number(a) - Number(b);
  });
  const spellLineParts = [];
  for (const tier of sortedTiers) {
    const values = (spellBuckets[tier] || []).sort((a, b) => a.localeCompare(b));
    if (!values.length) {
      continue;
    }
    const label = tier ? `(Tier ${tier})` : "";
    spellLineParts.push(`${label ? `${label}: ` : ""}${values.join(", ")}`);
  }
  if (spellLineParts.length) {
    addLine(`Spells: ${spellLineParts.join("; ")}`);
  } else {
    addLine("Spells: None");
  }

  return lines;
}

function getCharacterGearSlots(character, options = {}) {
  const { maxSlots = 20, excludeBackpack } = options;
  const lines = [];
  const freeCarry = [];
  const freeCarryIndices=[];
  let totalSlots = 0;
  let backpackReserved = false;
  const capacitySlots = Math.max(10, Number(character?.gearSlotsTotal || character?.stats?.STR || 10) || 10);

  const configuredMaxSlots = Number.isFinite(Number(maxSlots)) ? Number(maxSlots) : 20;
  const maxUsedSlots = configuredMaxSlots;
  const items = Array.isArray(character?.gear) ? character.gear : [];

  function formatStackName(name, units, groupSize) {
    return groupSize > 1 && units > 1 ? `${name} x ${units}` : name;
  }

  function formatFreeCarryName(item) {
    const itemName = String(item?.name || "Gear").trim() || "Gear";
    const valueLabel = formatTreasureValue(Number(item?.value) || 0);
    return `${itemName} (${valueLabel})`;
  }

  function formatGearLineName(item, fallbackName) {
    const itemName = String(fallbackName || item?.name || "Gear").trim() || "Gear";
    if (item?.treasureItem === true) {
      return `${itemName} (${formatTreasureValue(Number(item?.value) || 0)})`;
    }
    return itemName;
  }

  function getCoinCount() {
    return Math.max(0, getCharacterMoney(character, "gold"))
      + Math.max(0, getCharacterMoney(character, "silver"))
      + Math.max(0, getCharacterMoney(character, "copper"));
  }

  for (let itemIndex = 0; itemIndex < items.length; itemIndex += 1) {
    const item = items[itemIndex];
    const rawItemName = String(item?.name || "Gear").trim() || "Gear";
    const itemName = rawItemName;
    const displayItemName = formatGearLineName(item, itemName);
    const normalizedItemName = itemName.toLowerCase();
    const isTorch = normalizedItemName === "torch" || normalizedItemName.startsWith("torch ");
    const isBackpack = itemName.toLowerCase() === "backpack";
    const rawUnits = Number.isFinite(Number(item?.totalUnits)) && Number(item.totalUnits) > 0
      ? Math.max(0, Math.floor(Number(item.totalUnits)))
      : Number.isFinite(Number(item?.quantity)) && Number(item.quantity) > 0
        ? Math.max(0, Math.floor(Number(item.quantity)))
        : 1;
    const units = /arrows?/i.test(itemName)
      ? getCharacterAmmo(character, "arrows")
      : /bolts?/i.test(itemName)
        ? getCharacterAmmo(character, "bolts")
        : rawUnits;
    if (units <= 0) {
      continue;
    }
    const groupSize = getStackGroupSize(itemName);
    const slotsPerUnit = isTorch ? 1 : inferGearItemSlots(itemName, item);

    let remainingUnits = units;
    if (isBackpack && !backpackReserved && excludeBackpack !== false) {
      backpackReserved = true;
      if (units > 0) {
        freeCarry.push(itemName);
        freeCarryIndices.push(null);
      }
      remainingUnits = Math.max(0, units - 1);
    }

    if (item?.treasureItem === true && inferGearItemSlots(itemName, item) === 0) {
      freeCarry.push(formatFreeCarryName(item));
      freeCarryIndices.push(itemIndex);
      continue;
    }

    if (groupSize > 1) {
      const slotGroups = Math.max(1, Math.ceil(remainingUnits / groupSize));
      const displayName = formatStackName(displayItemName, remainingUnits, groupSize);
      lines.push({ text: displayName, available: totalSlots < capacitySlots, gearIndex: itemIndex, primary: true });
      totalSlots += 1;
      for (let group = 1; group < slotGroups; group += 1) {
        lines.push({ text: `   (${displayItemName})`, available: totalSlots < capacitySlots, gearIndex: itemIndex, primary: false });
        totalSlots += 1;
      }
      continue;
    }

    const unitText = formatStackName(displayItemName, 1, groupSize);
    for (let unit = 0; unit < remainingUnits; unit += 1) {
      for (let slot = 0; slot < slotsPerUnit; slot += 1) {
        lines.push({
          text: slot === 0 ? unitText : `   (${displayItemName})`,
          available: totalSlots < capacitySlots,
          gearIndex: itemIndex,
          primary: slot === 0
        });
        totalSlots += 1;
      }
    }
  }

  const carriedCoins = getCoinCount();
  const coinOverflow = Math.max(0, carriedCoins - 100);
  const coinBagSlots = getCharacterCoinBagSlots(character);
  if (coinBagSlots > 0) {
    lines.push({
      text: `bag of coins x ${coinOverflow}`,
      available: totalSlots < capacitySlots,
      gearIndex: null,
      primary: true
    });
    totalSlots += 1;
    for (let slot = 1; slot < coinBagSlots; slot += 1) {
      lines.push({
        text: "   (bag of coins)",
        available: totalSlots < capacitySlots,
        gearIndex: null,
        primary: false
      });
      totalSlots += 1;
    }
  }

  const total = maxUsedSlots;
  while (lines.length < total) {
    lines.push({
      text: "",
      available: lines.length < capacitySlots && lines.length < maxUsedSlots
    });
    totalSlots += 1;
  }
  const backpackIndex=freeCarryIndices.indexOf(null);
  if(backpackIndex>0) {
    freeCarry.unshift(...freeCarry.splice(backpackIndex,1));
    freeCarryIndices.unshift(...freeCarryIndices.splice(backpackIndex,1));
  }
  return {
    slots: lines.slice(0, maxUsedSlots),
    freeCarry: [`total coins x ${carriedCoins}`, ...freeCarry].slice(0, 10),
    freeCarryIndices: [null,...freeCarryIndices].slice(0,10)
  };
}

function getCharacterMoney(character, key) {
  return Number(character?.[key] ?? character?.raw?.[key] ?? 0) || 0;
}

function getCharacterMoneyCopper(character) {
  return getCharacterMoney(character, "gold") * 100
    + getCharacterMoney(character, "silver") * 10
    + getCharacterMoney(character, "copper");
}

function getCoinBreakdownCopper(coinBreakdown = {}) {
  return Math.max(0, Number(coinBreakdown.gold || 0)) * 100
    + Math.max(0, Number(coinBreakdown.silver || 0)) * 10
    + Math.max(0, Number(coinBreakdown.copper || 0));
}

function getMoneyFromCopper(totalCopper) {
  const copper = Math.max(0, Math.floor(Number(totalCopper) || 0));
  return {
    gold: Math.floor(copper / 100),
    silver: Math.floor((copper % 100) / 10),
    copper: copper % 10
  };
}

async function loadRulesData() {
  try {
    return await loadLocalJson("./data/rules-data.json");
  } catch (error) {
    console.warn("Using built-in rules fallback because rules-data.json could not load.", error);
    return null;
  }
}

function setCharacterMoneyValue(character, key, value) {
  const nextValue = Math.max(0, Math.min(9999999, Number.parseInt(value, 10) || 0));
  character[key] = nextValue;
  character.raw = character.raw || {};
  character.raw[key] = nextValue;
  return nextValue;
}

function updateCharacterMoneyField(character, key, nextValue) {
  if (sendSharedCommand("money", { key, amount: Number(nextValue) }, character)) return getCharacterMoney(character, key);
  const previousValue = getCharacterMoney(character, key);
  if (Number.parseInt(nextValue, 10) > previousValue) {
    return previousValue;
  }
  const clampedNext = setCharacterMoneyValue(character, key, nextValue);
  const delta = clampedNext - previousValue;
  if (delta < 0) {
    dropCharacterCoinPile(character, key, Math.abs(delta));
  }
  normalizeCharacterState(state);
  syncAllCharacterEquipmentDerivedStats();
  applyCharacterColorOverrides();
  ensureCharacterPresentation();
  markRunDirty();
  refreshCharacterViews(character);
  render();
  updatePanels();
  return clampedNext;
}

function getCoinLabel(key) {
  if (key === "gold") {
    return "g.p.";
  }
  if (key === "silver") {
    return "s.p.";
  }
  return "c.p.";
}

function getCoinBagName(key) {
  if (key === "gold") {
    return "g.p. pouch";
  }
  if (key === "silver") {
    return "s.p. pouch";
  }
  return "c.p. pouch";
}

function getCoinValueInCopper(key, amount) {
  const units = Math.max(0, Number(amount) || 0);
  if (key === "gold") {
    return units * 100;
  }
  if (key === "silver") {
    return units * 10;
  }
  return units;
}

function findMergeableCoinPile(key, tile) {
  return state.entities.find((entity) => (
    entity.type === "treasure" &&
    sameRoute(state, entity, tile) &&
    entity.subtype === `dropped-${key}` &&
    !entity.collected &&
    entity.x === tile.x &&
    entity.y === tile.y &&
    Number(entity.coinBreakdown?.[key] || 0) < 100
  )) || null;
}

function createCoinPileEntity(character, key, amount) {
  const tile = findEquipmentDropTile(character);
  const label = getCoinLabel(key);
  return {
    id: `coin-drop-${key}-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
    type: "treasure",
    subtype: `dropped-${key}`,
    kind: "coin-cache",
    name: `${amount} ${key === "gold" ? "gp" : key === "silver" ? "sp" : "cp"} on floor`,
    x: tile.x,
    y: tile.y,
    routeId: routeOf(state, tile),
    roomId: tile.roomId,
    hallId: tile.hallId || null,
    visible: true,
    revealed: true,
    collected: false,
    value: getCoinValueInCopper(key, amount) / 100,
    slots: Math.max(0, Math.ceil(Math.max(0, amount - 100) / 100)),
    bonusSlots: 0,
    priceless: false,
    description: `${amount} ${label} on the floor.`,
    coinBreakdown: {
      gold: key === "gold" ? amount : 0,
      silver: key === "silver" ? amount : 0,
      copper: key === "copper" ? amount : 0
    }
  };
}

function dropCharacterCoinPile(character, key, amount) {
  if (!character || !amount) {
    return null;
  }
  const tile = findEquipmentDropTile(character);
  let remaining = Math.max(0, Math.floor(Number(amount) || 0));
  let lastPile = null;
  while (remaining > 0) {
    const mergeable = findMergeableCoinPile(key, tile);
    if (mergeable) {
      mergeable.coinBreakdown = mergeable.coinBreakdown || { gold: 0, silver: 0, copper: 0 };
      const currentAmount = Math.max(0, Number(mergeable.coinBreakdown[key] || 0));
      const addAmount = Math.min(remaining, Math.max(0, 100 - currentAmount));
      mergeable.coinBreakdown[key] = currentAmount + addAmount;
      mergeable.value = getCoinValueInCopper(key, mergeable.coinBreakdown[key]) / 100;
      mergeable.slots = Math.max(0, Math.ceil(Math.max(0, mergeable.coinBreakdown[key] - 100) / 100));
      mergeable.name = `${mergeable.coinBreakdown[key]} ${key === "gold" ? "gp" : key === "silver" ? "sp" : "cp"} on floor`;
      mergeable.description = `${mergeable.coinBreakdown[key]} ${getCoinLabel(key)} on the floor.`;
      remaining -= addAmount;
      lastPile = mergeable;
      continue;
    }
    const nextAmount = Math.min(remaining, 100);
    const entity = createCoinPileEntity(character, key, nextAmount);
    state.entities.push(entity);
    remaining -= nextAmount;
    lastPile = entity;
  }
  return lastPile;
}

function getXpTarget(character) {
  return xpTarget(character);
}

function getTileAt(x, y) {
  if (!state || x < 0 || y < 0 || x >= state.map.width || y >= state.map.height) {
    return null;
  }
  return state.tiles[y * state.map.width + x] || null;
}

function isCharacterTileBlocked(x, y) {
  const tile = getTileAt(x, y);
  if (knownPitAt(state, x, y)) return true;
  if (!tile || tile.type !== "floor" || tile.meta?.layoutBlocks || tile.meta?.encounterOnly) {
    return true;
  }
  return state.entities.some((entity) => (
    entity.type === "trap" &&
    !entity.disarmed &&
    !entity.triggered &&
    entity.x === x &&
    entity.y === y
  ));
}

function findOpenCharacterTile(originX, originY, occupied = new Set()) {
  for (let radius = 1; radius <= 4; radius += 1) {
    const candidates = [];
    for (let y = originY - radius; y <= originY + radius; y += 1) {
      for (let x = originX - radius; x <= originX + radius; x += 1) {
        if (Math.max(Math.abs(x - originX), Math.abs(y - originY)) !== radius) {
          continue;
        }
        candidates.push({ x, y });
      }
    }
    for (const candidate of shuffleCoordinates(candidates)) {
      if (!isCharacterTileBlocked(candidate.x, candidate.y) && !occupied.has(`${candidate.x},${candidate.y}`)) {
        const tile = getTileAt(candidate.x, candidate.y);
        return { x: candidate.x, y: candidate.y, roomId: tile?.roomId || null, hallId: tile?.hallId || null };
      }
    }
  }
  const tile = getTileAt(originX, originY);
  return { x: originX, y: originY, roomId: tile?.roomId || null, hallId: tile?.hallId || null };
}

function getStartingStairsOrigin() {
  const stairs = state?.entities?.find?.((entity) => entity.doorKind === "stairs-up");
  if (Number.isFinite(Number(stairs?.x)) && Number.isFinite(Number(stairs?.y))) {
    return {
      x: Number(stairs.x),
      y: Number(stairs.y)
    };
  }
  const entranceRoomId = state?.generation?.entranceRoomId;
  const entranceRoom = entranceRoomId
    ? state.rooms?.find?.((room) => room.id === entranceRoomId)
    : null;
  if (entranceRoom) {
    return {
      x: Math.floor(Number(entranceRoom.x || 0) + Number(entranceRoom.width || 1) / 2),
      y: Math.floor(Number(entranceRoom.y || 0) + Number(entranceRoom.height || 1) / 2)
    };
  }
  return {
    x: Number(state?.player?.x || 0),
    y: Number(state?.player?.y || 0)
  };
}

function getOccupiedCharacterTiles(excludedIds = new Set()) {
  const occupied = new Set();
  for (const character of state?.characters || []) {
    if (excludedIds.has(character.id) || !hasCharacterMapPosition(character) || isCharacterDead(character)) {
      continue;
    }
    occupied.add(`${Number(character.x)},${Number(character.y)}`);
  }
  return occupied;
}

function placeCharactersNearStartingStairs(characters) {
  const list = (characters || []).filter(Boolean);
  if (!state || !list.length) {
    return;
  }
  const excluded = new Set(list.map((character) => character.id));
  const occupied = getOccupiedCharacterTiles(excluded);
  const origin = getStartingStairsOrigin();
  const entranceRoomId = state.generation?.entranceRoomId || getTileAt(origin.x, origin.y)?.roomId;
  const candidates = state.tiles.filter(tile => tile.roomId === entranceRoomId && !isCharacterTileBlocked(tile.x, tile.y))
    .sort((a, b) => Math.hypot(a.x - origin.x, a.y - origin.y) - Math.hypot(b.x - origin.x, b.y - origin.y));
  if (!candidates.length) throw new Error("The starting room has no safe entry tile.");
  for (const character of list) {
    if (isFloatingDisc(character)) throw new Error('Summoned discs cannot be imported as characters.');
    // A newly imported character cannot carry a prepared action from another turn.
    character.pendingSpell = null;
    character.pendingSteal = null;
    character.conditions = { prone: Number(character.hp) <= 0 };
    character.reviveTurnKey = '';
    character.focusSpell = null;
    character.faithEffects = [];
    character.wizardEffects = (character.wizardEffects || []).filter(effect => effect.type !== 'mage-armor');
    for (const item of character.gear || []) delete item.holyWeapon;
    character.lastMagicMissile = null;
    character.openingSpellActionSpent = false;
    // A small starting room may need shared tiles for a full 16-character party.
    const tile = candidates.find(tile => !occupied.has(`${tile.x},${tile.y}`)) || candidates[0];
    character.x = tile.x;
    character.y = tile.y;
    character.routeId = '';
    character.roomId = tile.roomId;
    occupied.add(`${tile.x},${tile.y}`);
  }
}

function getCharacterSpawnOrigin(character, index) {
  const active = getActiveCharacter(state);
  if (hasCharacterMapPosition(active) && active.id !== character?.id) {
    return {
      x: Number(active.x),
      y: Number(active.y)
    };
  }

  const previous = index > 0 ? state.characters[index - 1] : null;
  if (hasCharacterMapPosition(previous)) {
    return {
      x: Number(previous.x),
      y: Number(previous.y)
    };
  }

  if (hasCharacterMapPosition(state.player)) {
    return {
      x: Number(state.player.x),
      y: Number(state.player.y)
    };
  }

  return {
    x: 0,
    y: 0
  };
}

function getCharacterFallbackTile(character, index) {
  const origin = getCharacterSpawnOrigin(character, index);
  const originTile = getTileAt(Number(origin.x), Number(origin.y));
  if (originTile?.type === "floor") {
    return {
      x: Number(origin.x),
      y: Number(origin.y),
      roomId: originTile.roomId || null
    };
  }
  return findOpenCharacterTile(Number(origin.x) || 0, Number(origin.y) || 0);
}

function ensureCharacterPresentation() {
  if (!state?.characters?.length) {
    return;
  }
  const usedColors = new Set();

  for (const [index, character] of state.characters.entries()) {
    ensureEquipment(character, item => isShieldItem(item) ? canUseShield(character)
      : handItemKind(item) === "weapon" ? canUseWeapon(character, item) : true);
    if (isFloatingDisc(character)) {
      character.colorId = 'floating-disc'; character.colorValue = FLOATING_DISC_COLOR;
      character.raw ||= {}; character.raw.colorId = 'floating-disc'; character.raw.colorValue = FLOATING_DISC_COLOR;
      characterColorOverrides.delete(character.id);
    } else {
      const overrideColorId = characterColorOverrides.get(character.id);
      if (overrideColorId) {
        character.colorId = overrideColorId;
      } else if (character.raw?.colorId) {
        character.colorId = character.raw.colorId;
      }
      const paletteHasColor = CHARACTER_COLOR_PALETTE.some((color) => color.id === character.colorId);
      if (!paletteHasColor || usedColors.has(character.colorId)) {
        const preferred = index === 0 ? CHARACTER_COLOR_PALETTE[0] : null;
        const nextColor = preferred && !usedColors.has(preferred.id)
          ? preferred
          : CHARACTER_COLOR_PALETTE.find((color) => !usedColors.has(color.id)) || CHARACTER_COLOR_PALETTE[index % CHARACTER_COLOR_PALETTE.length];
        character.colorId = nextColor.id;
      }
      if (character.id && character.colorId) {
        characterColorOverrides.set(character.id, character.colorId);
        character.raw = character.raw || {};
        character.raw.colorId = character.colorId;
      }
      usedColors.add(character.colorId);
    }

    const tile = hasCharacterMapPosition(character)
      ? getTileAt(Number(character.x), Number(character.y))
      : null;
    if (!hasCharacterMapPosition(character) || tile?.type !== "floor") {
      const start = getCharacterFallbackTile(character, index);
      character.x = start.x;
      character.y = start.y;
      character.roomId = start.roomId;
    } else {
      character.roomId = character.roomId ?? tile.roomId ?? null;
    }
    character.colorValue = getCharacterColorValue(character);
  }

  const active = getActiveCharacter(state);
  if (hasCharacterMapPosition(active)) {
    state.player.x = active.x;
    state.player.y = active.y;
    state.player.routeId = routeOf(state, active);
    state.player.roomId = active.roomId ?? getTileAt(active.x, active.y)?.roomId ?? state.player.roomId;
    syncPlayerLightFromActiveCharacter();
  }
}

function syncPlayerToActiveCharacter() {
  const active = getActiveCharacter(state);
  if (!active || !hasCharacterMapPosition(active)) {
    return;
  }
  state.player.x = Number(active.x);
  state.player.y = Number(active.y);
  state.player.routeId = routeOf(state, active);
  state.player.roomId = active.roomId ?? getTileAt(active.x, active.y)?.roomId ?? state.player.roomId;
  syncPlayerLightFromActiveCharacter();
}

function activateCharacter(character) {
  const pendingCaster = state?.characters.find(candidate => candidate.pendingSpell && ownsCharacter(candidate));
  if (pendingCaster && pendingCaster.id !== character?.id) return null;
  if (isCombatActive() && !isCurrentCharacterTurn(character)) return null;
  if (!ownsCharacter(character)) return null;
  if (!state || !character) {
    return null;
  }
  setActiveCharacter(state, character.id);
  ensureCharacterPresentation();
  syncPlayerToActiveCharacter();
  recomputeVisibility(state);
  return getCurrentCharacter(character);
}

function syncActiveCharacterToPlayer() {
  const active = getActiveCharacter(state);
  if (!active) {
    return;
  }
  active.x = state.player.x;
  active.y = state.player.y;
  active.routeId = routeOf(state, state.player);
  active.roomId = state.player.roomId;
  syncActiveCharacterLightFromPlayer();
  syncFloatingDiscFollowers();
}

function getCharacterAtTile(x, y, { includeDiscs = false } = {}) {
  return state?.characters?.find((character) => (
    character.dead !== true &&
    character.slain !== true &&
    (includeDiscs || !isFloatingDisc(character)) &&
    hasCharacterMapPosition(character) &&
    sameRoute(state, character, state.player) &&
    Number(character.x) === x &&
    Number(character.y) === y
  )) || null;
}

function getCurrentCharacter(character) {
  if (!character?.id) {
    return character;
  }
  return state?.characters?.find((candidate) => candidate.id === character.id) || character;
}

function getCharacterAmmoOverrideKey(character, type) {
  return character?.id && type ? `${character.id}:${type}` : "";
}

function getDisplayCharacterAmmo(character, type) {
  const key = getCharacterAmmoOverrideKey(character, type);
  if (key && characterAmmoOverrides.has(key)) {
    return characterAmmoOverrides.get(key);
  }
  return getCharacterAmmo(character, type);
}

function setDisplayCharacterColor(character, color) {
  const currentCharacter = getCurrentCharacter(character);
  if (!currentCharacter?.id || !color?.id || isFloatingDisc(currentCharacter)) {
    return currentCharacter;
  }
  characterColorOverrides.set(currentCharacter.id, color.id);
  currentCharacter.colorId = color.id;
  currentCharacter.colorValue = color.value;
  currentCharacter.raw = currentCharacter.raw || {};
  currentCharacter.raw.colorId = color.id;
  return currentCharacter;
}

function applyCharacterColorOverrides() {
  if (!state?.characters?.length || !characterColorOverrides.size) {
    return;
  }
  for (const character of state.characters) {
    if (isFloatingDisc(character)) continue;
    const colorId = characterColorOverrides.get(character.id);
    if (!colorId) {
      continue;
    }
    character.colorId = colorId;
    character.colorValue = getCharacterColorValue(character);
    character.raw = character.raw || {};
    character.raw.colorId = colorId;
  }
}

function setDisplayCharacterAmmo(character, type, value) {
  const currentCharacter = getCurrentCharacter(character);
  const key = getCharacterAmmoOverrideKey(currentCharacter, type);
  if (key) {
    characterAmmoOverrides.set(key, value);
  }
  setCharacterAmmo(currentCharacter, type, value);
  return currentCharacter;
}

function applyCharacterAmmoOverrides() {
  if (!state?.characters?.length || !characterAmmoOverrides.size) {
    return;
  }
  for (const character of state.characters) {
    for (const type of ["arrows", "bolts"]) {
      const key = getCharacterAmmoOverrideKey(character, type);
      if (key && characterAmmoOverrides.has(key)) {
        setCharacterAmmo(character, type, characterAmmoOverrides.get(key));
      }
    }
  }
}

function refreshCharacterViews(character) {
  if (!isFloatingDisc(character) && sendSharedCommand("edit_character", { character_json: structuredClone(character) }, character)) return;
  const currentCharacter = getCurrentCharacter(character);
  clearMagicLightIfIncapacitated(currentCharacter);
  normalizeCharacterState(state);
  applyCharacterAmmoOverrides();
  syncAllCharacterEquipmentDerivedStats();
  applyCharacterColorOverrides();
  ensureCharacterPresentation();
  const refreshedCharacter = getCurrentCharacter(currentCharacter);
  markUserActivity();
  updateCharactersUi();
  if (ui.characterSheetModal && !ui.characterSheetModal.hidden) {
    renderCharacterDetail(refreshedCharacter, ui.characterSheetContent, { popout: true });
  }
  updatePanels();
}

function createDyingBanner(character) {
  if (!character?.dead && !character?.dyingRounds) {
    return null;
  }
  const banner = document.createElement("button");
  banner.type = "button";
  banner.className = character.dead ? "character-death-banner is-dead" : "character-death-banner";
  banner.textContent = character.dead
    ? "DEAD"
    : `${character.name} will perish in ${character.dyingRounds} rounds!`;
  banner.disabled = character.dead === true;
  banner.addEventListener("click", (event) => {
    event.stopPropagation();
  });
  return banner;
}

function renderCharacterCard(character) {
  const card = document.createElement("article");
  card.className = "character-card";
  const combatEntry = getCurrentCombatEntry();
  card.classList.toggle("is-active", character.id === state.activeCharacterId);
  card.classList.toggle("is-combat-inactive", Boolean(isCombatActive() && !(combatEntry?.type === "character" && combatEntry.id === character.id)));
  card.classList.toggle("is-slain", character.dead === true || character.slain === true);
  const tokenColor = getCharacterColorValue(character);
  card.style.setProperty('--token-color', tokenColor);
  card.style.setProperty('--card-background', mixTokenColor(tokenColor, '#ffffff', .1));
  card.style.setProperty('--card-border', mixTokenColor(tokenColor, '#000000', .5));
  card.style.setProperty('--card-inactive', mixTokenColor(tokenColor, '#d1d1d1', .1));
  card.style.setProperty('--card-current', mixTokenColor(tokenColor, '#ffffff', .2));
  const rgb = colorChannels(tokenColor);
  card.style.setProperty('--heading-ink', rgb[0] * .299 + rgb[1] * .587 + rgb[2] * .114 > 165 ? '#000' : '#fff');
  card.classList.toggle('is-combat-current', isCombatActive() && isCurrentCharacterTurn(character));
  card.tabIndex = 0;
  card.setAttribute("role", "button");
  card.setAttribute("aria-label", `Open ${character.name} sheet`);
  card.addEventListener("click", () => {
    openCharacterSheet(getCurrentCharacter(character) || character);
  });
  card.addEventListener("keydown", (event) => {
    if (event.target !== card) return;
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      event.stopPropagation();
      openCharacterSheet(getCurrentCharacter(character) || character);
    }
  });

  const header = document.createElement("div");
  header.className = "character-mini-header";
  header.tabIndex = 0; header.setAttribute('role', 'button'); header.setAttribute('aria-label', `Select ${character.name}`);
  const selectCharacter = event => {
    event.stopPropagation();
    if (character.id === state.activeCharacterId || !activateCharacter(getCurrentCharacter(character) || character)) return;
    updatePanels(); render();
  };
  header.addEventListener('click', selectCharacter);
  header.addEventListener('keydown', event => { if (event.target === header && ['Enter', ' '].includes(event.key)) { event.preventDefault(); selectCharacter(event); } });
  const reorder = document.createElement("button");
  reorder.type = "button";
  reorder.className = "character-reorder-handle";
  reorder.title = "reorder / follow";
  reorder.setAttribute("aria-label", `reorder / follow ${character.name}`);
  const disc = isFloatingDisc(character);
  const followAvailable = !disc && ownsCharacter(character) && state.characters.filter(member => !isFloatingDisc(member) && ownsCharacter(member)).length > 1;
  reorder.setAttribute('aria-pressed', String(disc || followAvailable && localFollowIds().includes(character.id)));
  reorder.classList.toggle('is-following', disc || followAvailable && localFollowIds().includes(character.id));
  const reorderIcon = document.createElement('img');
  reorderIcon.src = `./assets/reorder_${reorder.getAttribute('aria-pressed') === 'true' ? 'A' : 'B'}.png`;
  reorderIcon.alt = '';
  reorder.append(reorderIcon);
  if (disc) reorder.title = 'reorder / always follows caster';
  let reorderDragged = false, reorderStart = null;
  reorder.addEventListener("click", (event) => {
    event.stopPropagation();
    if (reorderDragged) { reorderDragged = false; return; }
    if (followAvailable) toggleCharacterFollow(character.id);
  });
  let reorderPointer = null;
  reorder.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    event.stopPropagation();
    reorderPointer = event.pointerId;
    reorderStart = [event.clientX, event.clientY];
    partyReorderDrag = { characterId: character.id, startedAt: performance.now() };
    reorder.setPointerCapture(event.pointerId);
  });
  reorder.addEventListener('pointermove', event => {
    if (event.pointerId !== reorderPointer) return;
    for (const card of ui.charactersList.children) card.removeAttribute('data-drop-position');
    if (Math.hypot(event.clientX - reorderStart[0], event.clientY - reorderStart[1]) <= 5) return;
    const target = document.elementFromPoint(event.clientX, event.clientY)?.closest('.character-card');
    if (target && target.dataset.characterId !== character.id) target.dataset.dropPosition = event.clientY >= target.getBoundingClientRect().top + target.offsetHeight / 2 ? 'after' : 'before';
    const panel = ui.charactersList.closest('.controls-panel');
    if (panel) {
      const rect = panel.getBoundingClientRect();
      if (event.clientY > rect.bottom - 40) panel.scrollTop += 12;
      else if (event.clientY < rect.top + 40) panel.scrollTop -= 12;
    }
  });
  reorder.addEventListener("pointerup", (event) => {
    if (event.pointerId !== reorderPointer) return;
    event.stopPropagation();
    reorderPointer = null;
    partyReorderDrag = null;
    reorderDragged = Math.hypot(event.clientX - reorderStart[0], event.clientY - reorderStart[1]) > 5;
    if (reorderDragged) {
      let target = document.elementFromPoint(event.clientX, event.clientY)?.closest('.character-card');
      if (!target && event.clientY >= ui.charactersList.getBoundingClientRect().bottom) target = ui.charactersList.lastElementChild;
      reorderLocalCharacter(character.id, target?.dataset.characterId, target ? event.clientY >= target.getBoundingClientRect().top + target.offsetHeight / 2 : false);
    }
    for (const card of ui.charactersList.children) card.removeAttribute('data-drop-position');
  });
  reorder.addEventListener("pointercancel", () => { reorderPointer = null; partyReorderDrag = null; updateCharactersUi(); });
  reorder.addEventListener("keydown", (event) => {
    if (!["ArrowUp", "ArrowDown"].includes(event.key)) return;
    event.preventDefault();
    event.stopPropagation();
    const ids = [...ui.charactersList.children].map((item) => item.dataset.characterId);
    const index = ids.indexOf(character.id);
    const nextIndex = Math.max(0, Math.min(ids.length - 1, index + (event.key === "ArrowUp" ? -1 : 1)));
    ids.splice(index, 1);
    ids.splice(nextIndex, 0, character.id);
    localStorage.setItem(roomOrderKey(), JSON.stringify(ids));
    updateCharactersUi();
  });
  header.append(reorder);
  const name = document.createElement("span");
  name.className = "character-mini-name";
  name.textContent = character.name;
  const identity = document.createElement('span');
  identity.className = 'character-mini-identity';
  identity.append(name);
  if (!disc) identity.append(document.createTextNode(` | ${character.ancestry || "Unknown"} | ${character.className || "Class"} ${character.level || 1}`));
  header.append(identity);
  if (character.luckTokens || character.luckToken) {
    const luck = document.createElement('button'); luck.type = 'button'; luck.className = 'luck-token-button';
    luck.title = 'Luck Token: reroll last unfavorable dice.'; luck.setAttribute('aria-label', luck.title);
    luck.disabled = !ownsCharacter(character) || !checkLuckEvent(state, { ownerId: character.id }).ok;
    luck.onclick = event => { event.stopPropagation(); try { performLuck(getCurrentCharacter(character)); } catch (error) { setStatus(error.message); } };
    header.append(luck);
  }
  const sheetButton = document.createElement('button'); sheetButton.type = 'button'; sheetButton.className = 'mini-sheet-open';
  sheetButton.title = disc ? 'Floating Disc color follows its caster' : `Change ${character.name} color`; sheetButton.setAttribute('aria-label', sheetButton.title);
  const sheetIcon = document.createElement('img'); sheetIcon.src = './assets/pop-up-sheet-icon.png'; sheetIcon.alt = '';
  sheetButton.append(sheetIcon);
  if (!disc) header.append(createCharacterColorControl(character, sheetButton));
  else sheetButton.disabled = true;
  header.append(sheetButton);
  if (isCharacterDying(character)) {
    const revive = document.createElement('button'); revive.type = 'button'; revive.textContent = 'Revive';
    revive.className = 'revive-button';
    revive.disabled = !canControlCharacter(character) || isCombatActive() && !isCurrentCharacterTurn(character);
    revive.addEventListener('click', event => { event.stopPropagation(); performRevive(getCurrentCharacter(character)); });
    header.insertBefore(revive, sheetButton);
  }
  card.append(header);
  if (disc) {
    card.classList.add('is-floating-disc');
    const cargo = document.createElement('div');
    cargo.className = 'character-mini-stats';
    cargo.textContent = `Gear ${20 - getCharacterGearFreeSlots(character)} / 20`;
    cargo.title = `Follows ${state.characters.find(member => member.id === character.summon.casterId)?.name || 'caster'}; ${Math.ceil(character.summon.remainingMs / 60000)} minutes remaining.`;
    card.append(cargo);
    return card;
  }
  const stats = document.createElement('div');
  stats.className = 'character-mini-stats';
  const vitals = document.createElement('span');
  vitals.className = 'character-mini-vitals';
  const armor = document.createElement('span');
  armor.textContent = `AC ${character.armorClass}`;
  armor.title = characterArmorDescription(character);
  vitals.append(armor, document.createTextNode(` | HP ${character.hp} |`));
  stats.append(vitals, buildMiniAttackLine(character));
  if (isThief(character) && character.companion?.kind !== 'doppelganger') {
    const stealth = document.createElement('button'); stealth.type = 'button'; stealth.textContent = 'Stealth';
    stealth.disabled = !canControlCharacter(character) || !isCharacterAbleToAct(character) || isCombatActive() && (!isCurrentCharacterTurn(character) || state.combat.actionUsed);
    stealth.addEventListener('click', event => { event.stopPropagation(); if (activateCharacter(character)) performStealth(); });
    stats.append(stealth);
    if (isStealthed(character)) {
      const steal = document.createElement('button'); steal.type = 'button'; steal.textContent = 'Steal'; steal.disabled = stealth.disabled;
      steal.addEventListener('click', event => { event.stopPropagation(); beginSteal(getCurrentCharacter(character)); }); stats.append(steal);
    }
  }
  if (isProne(character, state) && !isSleeping(character, state) && !isCharacterDying(character)) {
    const stand = document.createElement('button'); stand.type = 'button'; stand.textContent = 'Stand';
    stand.addEventListener('click', event => { event.stopPropagation(); performStand(getCurrentCharacter(character)); }); stats.append(stand);
  }
  if (isSleeping(character, state)) {
    const wake = document.createElement('button'); wake.type = 'button'; wake.textContent = 'Wake';
    wake.className = 'wake-button';
    wake.addEventListener('click', event => { event.stopPropagation(); performWake(getActiveCharacter(state), character.id); }); stats.append(wake);
  }
  card.append(stats);
  const abilities = document.createElement('div');
  abilities.className = 'character-mini-abilities';
  const pitActions = document.createElement('span'); pitActions.className = 'pit-mini-actions'; pitActions.dataset.characterId = character.id;
  updateMiniPitActions(pitActions, character); abilities.append(pitActions);
  if (state.entities.some(entity => entity.subtype === 'arcane-gate' && !entity.closed && entity.casterId === character.id)) {
    const command = { action: 'close-gate', entity_id: state.entities.find(entity => entity.subtype === 'arcane-gate' && !entity.closed && entity.casterId === character.id).id };
    const button = document.createElement('button'); button.type = 'button'; button.textContent = 'Close Gate';
    button.disabled = !canControlCharacter(character) || !isCharacterAbleToAct(character) || isCombatActive() && (!isCurrentCharacterTurn(character) || state.combat.actionUsed);
    button.addEventListener('click', event => { event.stopPropagation(); performMishapAction(getCurrentCharacter(character), command); }); abilities.append(button);
  }
  if (isRaving(character) || availableHands(character) < 2) {
    const condition = document.createElement('span'); condition.className = 'arcane-condition';
    condition.textContent = isRaving(character) ? 'Mad Raving' : `Petrified limbs (${availableHands(character)} usable hands)`; abilities.append(condition);
  }
  if (canLevelUp(character) || character.advancements?.some(event => !event.completed)) {
    const advance = document.createElement('button'); advance.type = 'button'; advance.textContent = advancementButtonLabel(character);
    advance.className = 'level-up-button';
    advance.disabled = !ownsCharacter(character) || isCombatActive() || restInProgress(state);
    advance.addEventListener('click', event => { event.stopPropagation(); openAdvancement(character.id); });
    abilities.append(advance);
  }
  if (canPhase(character)) {
    const phase = document.createElement('button'); phase.type = 'button'; phase.textContent = isIncorporeal(character) ? 'Become Corporeal' : 'Become Incorporeal';
    phase.addEventListener('click', event => { event.stopPropagation(); performPhase(getCurrentCharacter(character)); }); abilities.append(phase);
  }
  if(/\bhalfling\b/i.test(character.ancestry||'')&&character.companion?.kind!=='doppelganger') {
    const ability=document.createElement('button');ability.type='button';ability.textContent='Invisibility';
    ability.title='Three rounds. Recharges after an eight-hour rest that grants recovery.';
    ability.disabled=character.halflingInvisibilityUsed||!canControlCharacter(character)||!isCharacterAbleToAct(character)||isCombatActive()&&!isCurrentCharacterTurn(character);
    ability.addEventListener('click',event=>{event.stopPropagation();performHalflingInvisibility(character);});abilities.append(ability);
  }
  if (/\b(priest|wizard)\b/i.test(character.className || '') && character.companion?.kind !== 'doppelganger') {
    const spellcasting = document.createElement('button');
    spellcasting.type = 'button';
    spellcasting.className = 'spellcasting-menu-button';
    spellcasting.textContent = 'Spellcasting';
    spellcasting.setAttribute('aria-haspopup', 'dialog');
    spellcasting.addEventListener('click', event => { event.stopPropagation(); void openSpellcastingMenu(character); });
    abilities.append(spellcasting);
  }
  if (abilities.childElementCount) card.append(abilities);
  const dyingBanner = createDyingBanner(character);
  if (dyingBanner) {
    card.append(dyingBanner);
  }
  if (!canControlCharacter(character)) for (const button of card.querySelectorAll('button:not(.mini-sheet-open):not(.spellcasting-menu-button):not(.wake-button):not(.character-reorder-handle):not(.luck-token-button)')) button.disabled = true;
  for (const button of card.querySelectorAll('.attack-roll-button')) button.disabled = !isCharacterAbleToAct(character) || !canControlCharacter(character) || isIncorporeal(character) || isCombatActive() && state.combat.actionUsed;
  return card;
}

function removeCharacterCompletely(character) {
  if(!isSharedRoom()&&character.companion?.kind==='doppelganger')return betrayDoppelganger(character);
  if (sendSharedCommand(isCharacterDead(character) ? "bury" : "dismiss", {}, character)) return false;
  if (!state || !character?.id) {
    return false;
  }
  const index = state.characters.findIndex((candidate) => candidate.id === character.id);
  if (index === -1) {
    return false;
  }
  const removed = state.characters[index]?.name || "Character";
  state.characters.splice(index, 1);
  normalizeCharacterState(state);
  state.run.dirty = true;
  state.run.hasUserActivity = true;
  markUserActivity();
  updateCharactersUi();
  updatePanels();
  closeCharacterSheet();
  setStatus(`${removed} has been removed.`);
  return true;
}

function renderCharacterDetail(character, target = ui.characterDetail, options = {}) {
  const { popout = false } = options;
  if (!target) {
    return;
  }
  if (!character) {
    target.hidden = true;
    target.innerHTML = "";
    return;
  }
  if (isFloatingDisc(character)) {
    renderFloatingDiscSheet(character, target);
    return;
  }
  if(character.impersonation)character={...character,stats:character.impersonation.stats,
    deity:character.impersonation.deity,background:character.impersonation.background,title:character.impersonation.title,
    alignment:character.impersonation.alignment,languages:character.impersonation.languages};

  target.hidden = false;
  target.innerHTML = "";

  const sheet = document.createElement("article");
  sheet.className = "character-sheet";
  if (popout) {
    sheet.classList.add("character-sheet--popout");
  }
  sheet.classList.toggle("is-slain", character.dead === true || character.slain === true);

  const dyingBanner = createDyingBanner(character);
  if (dyingBanner) {
    sheet.append(dyingBanner);
  }

  const logo = document.createElement("div");
  logo.className = "sd-sheet-logo";
  logo.textContent = "ShadowDark";

  const nameBox = createSdField("Name", character.name, "sd-name-box");
  if (canLevelUp(character) || character.advancements?.some(event => !event.completed)) {
    const value = nameBox.querySelector('.sd-sheet-value');
    const name = document.createElement('span'); name.textContent = character.name;
    const button = document.createElement('button'); button.type = 'button'; button.className = 'level-up-button'; button.textContent = advancementButtonLabel(character);
    button.disabled = !ownsCharacter(character) || isCombatActive() || restInProgress(state);
    button.addEventListener('click', () => { void openAdvancement(character.id); });
    value.replaceChildren(name, button); value.classList.add('has-level-up');
  }
  const talentLines = buildTalentSpellLines(character.impersonation||character);
  const spellSummary = talentLines.find(line => /^Spells:/i.test(line));
  const languageLine = talentLines.find(line => /^Languages:/i.test(line));
  const displayedTalentKeys = new Set();
  const talentRows = [];
  for (const line of talentLines.filter((candidate) => !shouldSuppressTalentLine(candidate, talentLines))) {
    if (/^(?:Spells|Languages):/i.test(line)) continue;
    const presentation = talentPresentation(formatTalentSpellTextForSheet(line));
    let displayLine = presentation.text;
    if (/^Learn(?: Extra Spell)?:/i.test(displayLine)) continue;
    displayLine = displayLine.replace(/^Stat Bonus:\s*(STR|DEX|CON|INT|WIS|CHA):\s*([+-]?\d+)$/i, (_, key, bonus) =>
      `${Number(bonus) >= 0 ? '+' : ''}${Number(bonus)} ${{ STR: 'Strength', DEX: 'Dexterity', CON: 'Constitution', INT: 'Intelligence', WIS: 'Wisdom', CHA: 'Charisma' }[key.toUpperCase()]}`);
    const grit = /fighter/i.test(character.className) && displayLine.match(/^(?:Grit:\s*)?(Strength|Dexterity):?\s*(?:advantage)?$/i);
    if (grit) displayLine = `Grit: ${grit[1]}`;
    const displayKey = displayLine.toLowerCase().replace(/\s+/g, " ").trim();
    if (displayedTalentKeys.has(displayKey)) {
      continue;
    }
    displayedTalentKeys.add(displayKey);
    const talentRow = document.createElement('span');
    if (presentation.source) talentRow.title = presentation.source;
    const gritName = displayLine.match(/^Grit:\s*(Strength|Dexterity)/i)?.[1];
    if (gritName) talentRow.title = GRIT_DESCRIPTIONS[/strength/i.test(gritName) ? 'STR' : 'DEX'];
    if (/fighter/i.test(character.className) && /\bmastery\b/i.test(displayLine) && !/armor/i.test(displayLine)) {
      const bonus = 1 + Math.floor((character.level || 1) / 2);
      talentRow.title = `Fighter ${character.level || 1}: +${bonus} to hit; +${bonus} damage.`;
    }
    talentRow.append(character.impersonation?document.createTextNode(displayLine):createDamageAwareLine(displayLine, {
        sourceLabel: `${character.name} talent`,
        spellCheck: isSpellCheckText(displayLine),
        character
      }));
    talentRows.push(talentRow);
  }
  if (talentLines.some(isMagicMissileAdvantageTalentLine)) {
    const replacementSpell = getRemappedMagicMissileAdvantageSpell(character);
    if (replacementSpell) {
      const talentRow = createDamageAwareLine(`Cast ${replacementSpell} at advantage`, {
        sourceLabel: `${character.name} talent`,
        character
      });
      talentRow.title = 'Wizard 1';
      talentRows.push(talentRow);
    }
  }
  if (getBackstabMultiplier(character)) {
    const backstab = document.createElement('span');
    backstab.textContent = `Backstab x ${getBackstabMultiplier(character)}`;
    backstab.title = 'Thief 1';
    talentRows.unshift(backstab);
  }
  const attackRows = getRenderableAttacks(character)
    .filter((attackText) => !isBackstabAttackText(attackText))
    .slice(0,7)
    .map((attackText) => createAttackAwareLine(formatAttackForSheet(attackText), character));
  const talentPanelTitle = getCharacterKnownSpellNames(character.impersonation||character).length ? "Talents / Spells" : "Talents";
  const talents = createSdPanel(talentPanelTitle, createTalentsContent(talentRows, spellSummary, languageLine, character), "sd-talents-panel");
  const attacks = createSdPanel("Attacks", buildSheetLines(attackRows, 7), "sd-attacks-panel");
  const gear = createSdGearPanel(character);
  const dismissal = popout ? createSdDismissPanel(character) : null;

  const statCluster = document.createElement("div");
  statCluster.className = "sd-stat-cluster";
  for (const key of ["STR", "INT", "DEX", "WIS", "CON", "CHA"]) {
    statCluster.append(createSdField(key, formatAbilityPair(character, key), "sd-stat-box"));
  }
  statCluster.append(createSdField("HP", `${character.hp} / ${character.maxHitPoints}`, "sd-vital-box"));
  const acField=createSdField("AC", `${character.armorClass}`, "sd-vital-box");acField.title=characterArmorDescription(character);statCluster.append(acField);

  const identity = document.createElement("div");
  identity.className = "sd-identity-column";
  identity.append(
    createSdField("Ancestry", character.ancestry || "Unknown"),
    createSdField("Class", character.className || "Class"),
    createSdField("Level", `${character.level || 1}`, "sd-level-box"),
    createSdField("XP", `${character.XP || 0} / ${getXpTarget(character)}`, "sd-xp-box"),
    createSdField("Title", character.title || "Unknown"),
    createSdField("Alignment", character.alignment || "Unknown"),
    createSdField("Background", character.background || "Unknown"),
    createSdField("Deity", character.deity || "Unknown")
  );

  sheet.append(logo, nameBox, talents, statCluster, identity, attacks, gear);
  if (dismissal) {
    const heading=talents.querySelector('h3');
    const toolbar=document.createElement('span');toolbar.className='sd-sheet-toolbar';
    if (isCharacterInStartingRoom(character)) {
      const trade = document.createElement('section');
      trade.className = 'sd-character-options sd-trade-options';
      trade.hidden = true;
      const tradeActions = document.createElement('div');
      tradeActions.className = 'sd-sheet-action-row';
      const tradeButton = document.createElement('button');
      tradeButton.type = 'button'; tradeButton.className = 'sd-sheet-icon sd-trade-button';
      tradeButton.title = 'Buy / Sell Treasure'; tradeButton.setAttribute('aria-label', 'Buy / Sell Treasure');
      tradeButton.setAttribute('aria-expanded', 'false');
      const tradeIcon = document.createElement('img'); tradeIcon.src = './assets/buy.png'; tradeIcon.alt = '';
      tradeButton.append(tradeIcon);
      const canTrade = canControlCharacter(character) && isCharacterAbleToAct(character) && !isCombatActive();
      tradeButton.disabled = !canTrade;
      for (const [label, open] of [['Buy', openStartingRoomShop], ['Sell Treasure', openSellTreasurePanel]]) {
        const button = document.createElement('button'); button.type = 'button'; button.textContent = label;
        button.className = label === 'Buy' ? 'sd-buy-button' : 'sd-sell-button'; button.disabled = !canTrade;
        button.addEventListener('click', event => {
          event.stopPropagation(); trade.hidden = true; tradeButton.setAttribute('aria-expanded', 'false');
          open(character, tradeButton);
        });
        tradeActions.append(button);
      }
      trade.append(tradeActions); talents.append(trade);
      tradeButton.addEventListener('click', event => {
        event.stopPropagation(); dismissal.hidden = true;
        heading.querySelector('[aria-label="Character options"]')?.setAttribute('aria-expanded', 'false');
        trade.hidden = !trade.hidden; tradeButton.setAttribute('aria-expanded', String(!trade.hidden));
      });
      toolbar.append(tradeButton);
      heading.classList.add('has-trade-icon');
    }
    const optionsButton=document.createElement('button');optionsButton.type='button';optionsButton.className='sd-sheet-icon';optionsButton.title='Character options';
    optionsButton.setAttribute('aria-label','Character options');optionsButton.setAttribute('aria-expanded','false');
    const icon=document.createElement('img');icon.src='./assets/gear.png';icon.alt='';optionsButton.append(icon);
    dismissal.classList.add('sd-character-options');dismissal.hidden=true;
    optionsButton.addEventListener('click',event=>{event.stopPropagation();talents.querySelector('.sd-trade-options')?.setAttribute('hidden','');heading.querySelector('.sd-trade-button')?.setAttribute('aria-expanded','false');dismissal.hidden=!dismissal.hidden;optionsButton.setAttribute('aria-expanded',String(!dismissal.hidden));});
    ui.characterSheetClose.classList.add('sd-sheet-icon');
    toolbar.append(optionsButton,ui.characterSheetClose);heading.append(toolbar);talents.append(dismissal);
  }
  target.append(sheet);
  target.dataset.characterId = character.id;
  target.dataset.interactionKey = characterSheetInteractionKey(character);
  if(character.companion) {
    for(const control of target.querySelectorAll('.sd-rename-button, .sd-save-character-button'))control.disabled=true;
  }
  if (isCombatActive()) {
    for (const control of target.querySelectorAll('.sd-rename-button, .sd-coin-field input')) control.disabled = true;
  }
  if (!canControlCharacter(character) || !isCharacterAbleToAct(character) || (isCombatActive() && (!isCurrentCharacterTurn(character) || state.combat.actionUsed))) {
    for (const control of target.querySelectorAll("input, select, textarea, button:not(.sd-sheet-icon):not(.sd-sheet-spellcasting-button)")) control.disabled = true;
    const save = target.querySelector(".sd-save-character-button");
    if (save && ownsCharacter(character)) save.disabled = false;
    const bury = target.querySelector(".sd-dismiss-button");
    if (bury && !isCombatActive() && isCharacterDead(character) && canBuryCharacter(character)) bury.disabled = false;
  }
  requestAnimationFrame(()=>{
    fitCharacterSheetText(target);
    updateTruncatedSheetTitles(target);
  });
}

function renderFloatingDiscSheet(character, target) {
  target.hidden = false;
  target.replaceChildren();
  const sheet = document.createElement('div');
  sheet.className = 'character-sheet character-sheet--popout character-sheet--disc';
  const gear = createSdGearPanel(character);
  const toolbar = document.createElement('span');
  toolbar.className = 'sd-sheet-toolbar';
  ui.characterSheetClose.classList.add('sd-sheet-icon');
  toolbar.append(ui.characterSheetClose);
  gear.querySelector('.sd-gear-heading-row').append(toolbar);
  sheet.append(gear); target.append(sheet);
  target.dataset.characterId = character.id;
  target.dataset.interactionKey = characterSheetInteractionKey(character);
  const disabled = !canControlCharacter(character) || !canUseCharacterInventory(character) ||
    Boolean(inventoryController(character)?.pendingSpell) || isCombatActive() && state.combat.actionUsed;
  if (disabled) for (const control of target.querySelectorAll('input,select,button:not(.sd-sheet-icon)')) control.disabled = true;
  requestAnimationFrame(() => updateTruncatedSheetTitles(target));
}

function enableCharacterNameEdit(character) {
  const currentCharacter = getCurrentCharacter(character);
  const valueNode = ui.characterSheetContent?.querySelector(".sd-name-box .sd-sheet-value");
  if (!currentCharacter || !valueNode) {
    return;
  }
  valueNode.contentEditable = "true";
  valueNode.setAttribute("role", "textbox");
  valueNode.classList.add("is-editing");
  valueNode.focus();
  const selection = window.getSelection();
  const range = document.createRange();
  range.selectNodeContents(valueNode);
  selection?.removeAllRanges();
  selection?.addRange(range);

  let committed = false;
  const commitName = () => {
    if (committed) {
      return;
    }
    committed = true;
    const nextName = valueNode.textContent.trim() || currentCharacter.name || "Character";
    currentCharacter.name = nextName;
    currentCharacter.raw = currentCharacter.raw || {};
    currentCharacter.raw.name = nextName;
    refreshCharacterViews(currentCharacter);
    render();
    updatePanels();
    setStatus(`Renamed character to ${nextName}.`);
  };

  valueNode.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      commitName();
    }
  }, { once: false });
  valueNode.addEventListener("blur", commitName, { once: true });
}

function isCharacterInStartingRoom(character) {
  const entranceRoomId = state?.generation?.entranceRoomId;
  const roomId = character?.roomId || state?.player?.roomId || null;
  if (entranceRoomId && roomId === entranceRoomId) {
    return true;
  }
  const stairs = state?.entities?.find?.((entity) => entity.doorKind === "stairs-up");
  if (!stairs) {
    return false;
  }
  if (stairs.roomId && roomId === stairs.roomId) {
    return true;
  }
  const tile = getTileAt(
    Number.isFinite(Number(character?.x)) ? Number(character.x) : state?.player?.x,
    Number.isFinite(Number(character?.y)) ? Number(character.y) : state?.player?.y
  );
  return Boolean(tile?.hallId && stairs.hallId && tile.hallId === stairs.hallId);
}

function createShopGearItem(config) {
  return {
    instanceId: `shop-${config.id}-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
    gearId: `shop-${config.id}`,
    name: config.name,
    type: "sundry",
    quantity: config.quantity || 1,
    totalUnits: config.quantity || 1,
    slots: config.slots,
    cost: config.cost,
    currency: config.currency
  };
}

const STARTING_ROOM_SHOP_ITEMS = [
  { id: "torch", name: "Torch", costLabel: "5 s.p.", costCopper: 50, cost: 5, currency: "sp", slots: 1 },
  { id: "rations", name: "Rations", quantity: 3, costLabel: "5 s.p.", costCopper: 50, cost: 5, currency: "sp", slots: 1 },
  { id: "flint-and-steel", name: "Flint and steel", costLabel: "5 s.p.", costCopper: 50, cost: 5, currency: "sp", slots: 1 },
  { id: "lantern", name: "Lantern", costLabel: "5 g.p.", costCopper: 500, cost: 5, currency: "gp", slots: 1 },
  { id: "oil-flask", name: "Oil, flask", costLabel: "5 s.p.", costCopper: 50, cost: 5, currency: "sp", slots: 1 }
];

function addPurchasedGearToCharacterOrFloor(character, item) {
  const slotCost = getPickupSlotCost(character, item);
  if (getCharacterGearFreeSlots(character) >= slotCost) {
    character.gear = Array.isArray(character.gear) ? character.gear : [];
    const existing = findExistingGearStack(character, item);
    if (existing) {
      setGearItemUnits(existing, getGearUnits(existing) + getPileUnits(item));
    } else {
      character.gear.push(JSON.parse(JSON.stringify(item)));
    }
    return "gear";
  }
  addDroppedGearPile(item, findEquipmentDropTile(character));
  return "floor";
}

function buyStartingRoomShopItem(character, config) {
  if (sendSharedCommand("buy_gear", { item_id: config.id }, character)) return;
  const currentCharacter = getCurrentCharacter(character);
  if (!currentCharacter || !isCharacterInStartingRoom(currentCharacter)) {
    return false;
  }
  const currentCopper = getCharacterMoneyCopper(currentCharacter);
  const assets = ensurePartyAssets();
  const partyCopper = getMoneyCopper(assets);
  if (currentCopper + partyCopper < config.costCopper) {
    setStatus("Not enough character and party coins.");
    return false;
  }
  const personalPayment = Math.min(currentCopper, config.costCopper);
  setCharacterMoneyFromCopper(currentCharacter, currentCopper - personalPayment);
  setMoneyFromCopper(assets, partyCopper - (config.costCopper - personalPayment));
  const item = createShopGearItem(config);
  const destination = addPurchasedGearToCharacterOrFloor(currentCharacter, item);
  normalizeCharacterState(state);
  syncAllCharacterEquipmentDerivedStats();
  applyCharacterColorOverrides();
  ensureCharacterPresentation();
  syncPlayerLightFromActiveCharacter();
  recomputeVisibility(state);
  markRunDirty();
  markUserActivity();
  refreshCharacterViews(currentCharacter);
  render();
  updatePanels();
  setStatus(`${currentCharacter.name || "Character"} buys ${config.name}${destination === "floor" ? "; no gear slot was free, so it lands on the floor." : "."}`);
  return true;
}

function closeActiveShopPanel() {
  activeShopCleanup?.();
  activeShopCleanup = null;
  activeShopRefresh = null;
  activeShopPanel?.remove();
  activeShopPanel = null;
}

function createShopHeading(title, close) {
  const heading = document.createElement('h3');
  heading.textContent = title;
  const button = document.createElement('button');
  button.type = 'button'; button.className = 'sd-sheet-icon sd-shop-close';
  button.textContent = '\u00d7'; button.setAttribute('aria-label', `Close ${title.toLowerCase()}`);
  button.addEventListener('click', close); heading.append(button);
  return heading;
}

function openStartingRoomShop(character, anchor) {
  closeActiveShopPanel();
  closeActiveSellPanel();
  const currentCharacter = getCurrentCharacter(character);
  if (!currentCharacter || !canControlCharacter(currentCharacter) || !isCharacterAbleToAct(currentCharacter) || !isCharacterInStartingRoom(currentCharacter) || isCombatActive()) {
    return;
  }
  const panel = document.createElement("section");
  panel.className = "sd-shop-popover";
  const renderShop = () => {
    const currentCharacter = state.characters.find(item => item.id === character.id);
    if (!currentCharacter || !canControlCharacter(currentCharacter) || !isCharacterAbleToAct(currentCharacter) || !isCharacterInStartingRoom(currentCharacter) || isCombatActive()) { closeActiveShopPanel(); return; }
    const key = JSON.stringify([currentCharacter.name, ...['gold', 'silver', 'copper'].map(coin => getCharacterMoney(currentCharacter, coin)), ensurePartyAssets()]);
    if (panel.dataset.renderKey === key) return;
    panel.dataset.renderKey = key;
    const scrollTop = panel.scrollTop;
    const focusedItem = panel.contains(document.activeElement) ? document.activeElement.dataset.shopItem : null;
    panel.replaceChildren(createShopHeading('Buy', closeActiveShopPanel));
    const coinLine = document.createElement("div");
    coinLine.className = "sd-shop-coins";
    coinLine.textContent = `${currentCharacter.name || "Character"} coins: GP ${getCharacterMoney(currentCharacter, "gold")}  SP ${getCharacterMoney(currentCharacter, "silver")}  CP ${getCharacterMoney(currentCharacter, "copper")}`;
    panel.append(coinLine);

    const partyCoins = document.createElement("div");
    partyCoins.className = "sd-shop-coins";
    partyCoins.textContent = `Party assets: ${formatMoneyParts(ensurePartyAssets())}`;
    panel.append(partyCoins);
    const availableCopper = getCharacterMoneyCopper(currentCharacter) + getMoneyCopper(ensurePartyAssets());
    for (const config of STARTING_ROOM_SHOP_ITEMS) {
      const row = document.createElement("div");
      row.className = "sd-shop-row";
      const label = document.createElement("span");
      label.textContent = config.quantity > 1 ? `${config.name} (${config.quantity})` : config.name;
      const price = document.createElement("span");
      price.textContent = config.costLabel;
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = "buy";
      button.dataset.shopItem = config.id;
      button.disabled = availableCopper < config.costCopper;
      row.classList.toggle("is-unavailable", button.disabled);
      button.addEventListener("click", (event) => {
        event.stopPropagation();
        buyStartingRoomShopItem(currentCharacter, config);
        if (activeShopPanel === panel) renderShop();
      });
      row.append(label, price, button);
      panel.append(row);
    }
    panel.scrollTop = scrollTop;
    if (focusedItem) [...panel.querySelectorAll('[data-shop-item]')].find(button => button.dataset.shopItem === focusedItem)?.focus({ preventScroll: true });
  };

  document.body.append(panel);
  activeShopPanel = panel;
  activeShopRefresh = renderShop;
  renderShop();
  const anchorRect = anchor?.getBoundingClientRect?.() || getCharacterSheetCard()?.getBoundingClientRect();
  const panelRect = panel.getBoundingClientRect();
  const left = Math.min(window.innerWidth - panelRect.width - 12, Math.max(12, anchorRect.left));
  const top = Math.min(window.innerHeight - panelRect.height - 12, Math.max(12, anchorRect.bottom + 6));
  panel.style.left = `${left}px`;
  panel.style.top = `${top}px`;
  const closeOnOutside = (event) => {
    if (!panel.contains(event.target) && event.target !== anchor) {
      closeActiveShopPanel();
    }
  };
  activeShopCleanup = () => document.removeEventListener('pointerdown', closeOnOutside);
  setTimeout(() => { if (activeShopPanel === panel) document.addEventListener('pointerdown', closeOnOutside); }, 0);
}

function createSdDismissPanel(character) {
  const panel = document.createElement("section");
  panel.className = "sd-sheet-panel sd-dismiss-panel";

  const name = character?.name || "character";
  const isDead = character.dead === true || character.slain === true || (character.hp <= 0 && (character.dyingRounds || 0) <= 0);
  const actionLabel = `${isDead ? "Bury" : "Dismiss"} ${name}`;

  const dismissButton = document.createElement("button");
  dismissButton.type = "button";
  dismissButton.className = "sd-dismiss-button";
  dismissButton.textContent = actionLabel;

  const buttonWrap = document.createElement("div");
  buttonWrap.className = "sd-dismiss-button-wrap";
  const actionRow = document.createElement("div");
  actionRow.className = "sd-sheet-action-row";
  const renameButton = document.createElement("button");
  renameButton.type = "button";
  renameButton.className = "sd-rename-button";
  renameButton.textContent = `Rename ${name}`;
  renameButton.addEventListener("click", (event) => {
    event.stopPropagation();
    enableCharacterNameEdit(character);
  });
  const saveCharacterButton = document.createElement("button");
  saveCharacterButton.type = "button";
  saveCharacterButton.className = "sd-save-character-button";
  saveCharacterButton.textContent = `Save ${name}`;
  saveCharacterButton.addEventListener("click", (event) => {
    event.stopPropagation();
    saveCharacterSnapshot(character);
  });
  actionRow.append(dismissButton, renameButton, saveCharacterButton);
  buttonWrap.append(actionRow);

  if (isDead) {
    dismissButton.addEventListener("click", () => {
      setStatus(`you say a few words and bury ${name} in the dungeon.`);
      removeCharacterCompletely(character);
    });
    panel.append(buttonWrap);
  } else {
    const confirmation = document.createElement("div");
    confirmation.className = "sd-dismiss-confirmation";
    confirmation.hidden = true;
    const promptText = document.createElement("div");
    promptText.className = "sd-dismiss-prompt-text";
    promptText.textContent = "I'm really being fired?";

    const actions = document.createElement("div");
    actions.className = "sd-dismiss-confirmation-actions";
    const yesButton = document.createElement("button");
    yesButton.type = "button";
    yesButton.textContent = "Yes";
    const noButton = document.createElement("button");
    noButton.type = "button";
    noButton.textContent = "No";

    yesButton.addEventListener("click", () => {
      removeCharacterCompletely(character);
    });

    noButton.addEventListener("click", () => {
      confirmation.hidden = true;
    });

    actions.append(yesButton, noButton);
    confirmation.append(promptText, actions);
    buttonWrap.append(confirmation);

    dismissButton.addEventListener("click", () => {
      confirmation.hidden = false;
    });
    panel.append(buttonWrap);
  }

  return panel;
}

function buildMiniAttackLine(character) {
  const line = document.createElement("div");
  line.className = "character-mini-attacks";
  const attacks = getRenderableAttacks(character)
    .filter((attack) => !isBackstabAttackText(attack))
    .filter(attack=>!isSpellCheckText(attack)&&isAttackEquipped(character,parseAttackText(attack)))
    .map((attack) => createMiniAttackNode(String(attack), character))
    .filter(Boolean);
  if (!attacks.length) {
    line.textContent = "Attacks: None";
    return line;
  }
  line.append(document.createTextNode("Attacks: "));
  attacks.forEach((attackNode, index) => {
    if (index > 0) {
      line.append(document.createTextNode("; "));
    }
    line.append(attackNode);
  });
  line.title ||= [character.stealthed ? 'Stealthed' : '', character.lightSource ? `Light: ${character.lightSource}` : ''].filter(Boolean).join('; ');
  return line;
}

function createMiniAttackNode(attackText, character) {
  if (isSpellCheckText(attackText)) {
    return createDamageAwareLine(formatTalentSpellTextForSheet(formatAttackForSheet(attackText)), {
      sourceLabel: `${character?.name || "Character"} spell`,
      spellCheck: true,
      character
    });
  }
  const attack = parseAttackText(attackText);
  if (!attack) {
    return null;
  }
  const rawName = String(attackText || "").replace(/^ATTACKS?:\s*/i, "").split(":")[0] || attack.name;
  const ammoType = /bolt|crossbow/i.test(rawName)
    ? "bolts"
    : /bow|arrow/i.test(rawName)
      ? "arrows"
      : "";
  const attackNode = document.createElement("span");
  attackNode.className = "character-mini-attack-entry";
  attackNode.append(createAttackButton(character, attack));
  if (attack.bonusText) {
    attackNode.append(document.createTextNode(` ${attack.bonusText}`));
  }
  if (attack.detail) {
    appendCompactAttackDetail(attackNode, attack, character);
  }
  const backstab=getBackstabMultiplier(character);
  if(backstab)attackNode.title=`Backstab: ${multiplyDamageDice(getAttackDamageExpression(attack),backstab)} damage`;
  applyAttackEquipmentState(attackNode, character, attack);
  return attackNode;
}

function createCharacterColorControl(character, anchor = null) {
  const wrap = document.createElement("span");
  wrap.className = "character-color-control";
  ["click", "mousedown", "mouseup", "pointerdown", "pointerup", "keydown"].forEach((eventName) => {
    wrap.addEventListener(eventName, (event) => event.stopPropagation());
  });

  const button = anchor || document.createElement("button");
  if (anchor) {
    anchor.tabIndex = 0; anchor.setAttribute('role', 'button'); anchor.setAttribute('aria-label', `Change ${character.name} color`);
    anchor.addEventListener('keydown', event => {
      if (event.target === anchor && ['Enter', ' '].includes(event.key)) { event.preventDefault(); event.stopPropagation(); anchor.click(); }
    });
  }
  if (!anchor) { button.type = "button"; button.className = "character-color-dot"; }
  button.title = "Change character color";
  const currentColorValue = getCharacterColorValue(character);
  button.style.setProperty("--character-color", currentColorValue);
  if (!anchor) { button.style.setProperty("background-color", currentColorValue); button.style.setProperty("background", currentColorValue); }
  button.style.backgroundImage = "none";

  const picker = document.createElement("span");
  picker.className = "character-color-picker";
  picker.hidden = true;
  ["click", "mousedown", "mouseup", "pointerdown", "pointerup", "keydown"].forEach((eventName) => {
    picker.addEventListener(eventName, (event) => event.stopPropagation());
  });

  const usedColors = new Set(state.characters.filter((candidate) => candidate.id !== character.id).map((candidate) => candidate.colorId));
  for (const color of CHARACTER_COLOR_PALETTE) {
    const colorButton = document.createElement("button");
    colorButton.type = "button";
    colorButton.className = "character-color-choice";
    colorButton.title = color.label;
    colorButton.disabled = usedColors.has(color.id);
    colorButton.style.setProperty("--character-color", color.value);
    colorButton.style.setProperty("background-color", color.value);
    colorButton.style.setProperty("background", color.value);
    colorButton.style.backgroundImage = "none";
    colorButton.addEventListener("click", (event) => {
      event.stopPropagation();
      if (colorButton.disabled) {
        return;
      }
      closeActiveColorPicker(picker);
      setDisplayCharacterColor(character, color);
      markUserActivity();
      updateCharactersUi();
      render();
    });
    picker.append(colorButton);
  }

  button.addEventListener("click", (event) => {
    if (event.target.closest?.('button') && event.target.closest('button') !== button) return;
    event.stopPropagation();
    if (event.button !== 0 && event.button !== undefined) {
      return;
    }
    const wasOpen = !picker.hidden;
    if (activeColorPicker?.picker && activeColorPicker.picker !== picker) {
      closeActiveColorPicker();
    }

    if (wasOpen) {
      closeActiveColorPicker(picker);
      return;
    }

    picker.hidden = false;
    document.body.append(picker);
    picker.classList.add("is-floating");
    const buttonRect = button.getBoundingClientRect();
    picker.style.left = `${buttonRect.left}px`;
    picker.style.top = `${buttonRect.bottom + 6}px`;
    activeColorPicker = {
      picker,
      anchor: anchor || wrap,
      home: wrap
    };
  });

  if (!anchor) wrap.append(button);
  wrap.append(picker);
  return wrap;
}

let lastMousePosition = { x: 0, y: 0 };
let activeColorPicker = null;
const COLOR_PICKER_CLOSE_DISTANCE = 20;

function isPointerInActiveColorPickerBuffer(point) {
  if (!activeColorPicker?.picker || activeColorPicker.picker.hidden) {
    return false;
  }
  const pickerRect = activeColorPicker.picker.getBoundingClientRect();
  const anchorRect = activeColorPicker.anchor?.getBoundingClientRect?.() || pickerRect;
  const minX = Math.min(pickerRect.left, anchorRect.left) - COLOR_PICKER_CLOSE_DISTANCE;
  const maxX = Math.max(pickerRect.right, anchorRect.right) + COLOR_PICKER_CLOSE_DISTANCE;
  const minY = Math.min(pickerRect.top, anchorRect.top) - COLOR_PICKER_CLOSE_DISTANCE;
  const maxY = Math.max(pickerRect.bottom, anchorRect.bottom) + COLOR_PICKER_CLOSE_DISTANCE;
  return (
    point.x >= minX &&
    point.x <= maxX &&
    point.y >= minY &&
    point.y <= maxY
  );
}

function closeActiveColorPicker(expectedPicker = null) {
  if (!activeColorPicker?.picker) {
    return;
  }
  if (expectedPicker && activeColorPicker.picker !== expectedPicker) {
    return;
  }
  activeColorPicker.picker.hidden = true;
  activeColorPicker.picker.classList.remove("is-floating");
  activeColorPicker.picker.style.left = "";
  activeColorPicker.picker.style.top = "";
  if (activeColorPicker.home && activeColorPicker.picker.parentElement !== activeColorPicker.home) {
    activeColorPicker.home.append(activeColorPicker.picker);
  }
  activeColorPicker = null;
}

document.addEventListener("pointermove", (event) => {
  lastMousePosition = { x: event.clientX, y: event.clientY };
  if (activeColorPicker?.picker && !isPointerInActiveColorPickerBuffer(lastMousePosition)) {
    closeActiveColorPicker();
  }
});
document.addEventListener('pointerdown', event => {
  if (activeColorPicker && !activeColorPicker.picker.contains(event.target) && !activeColorPicker.anchor?.contains(event.target)) closeActiveColorPicker();
});

function createMiniInlineNumberField(value, max, onChange) {
  const field = document.createElement("span");
  field.className = "character-mini-inline-field";
  ["click", "mousedown", "pointerdown", "keydown"].forEach((eventName) => {
    field.addEventListener(eventName, (event) => event.stopPropagation());
  });
  const controls = document.createElement("span");
  controls.className = "character-mini-spinner";
  const up = document.createElement("button");
  up.type = "button";
  up.textContent = "^";
  const down = document.createElement("button");
  down.type = "button";
  down.textContent = "v";
  const input = document.createElement("input");
  input.type = "number";
  input.min = "0";
  input.max = `${max}`;
  input.value = `${value}`;
  input.inputMode = "numeric";
  input.step = "1";
  const emitValue = () => {
    const parsed = Number.parseInt(input.value, 10);
    const next = Number.isFinite(parsed) ? Math.max(0, Math.min(max, parsed)) : value;
    input.value = `${next}`;
    onChange(next);
  };
  input.addEventListener("change", emitValue);
  input.addEventListener("blur", emitValue);
  input.addEventListener("input", () => {
    const parsed = Number.parseInt(input.value, 10);
    const clamped = Number.isFinite(parsed) ? Math.max(0, Math.min(max, parsed)) : value;
    if (parsed !== Number(input.value)) {
      input.value = `${clamped}`;
    }
    if (Number.isFinite(parsed)) {
      onChange(clamped);
    }
  });
  up.addEventListener("click", (event) => {
    event.stopPropagation();
    const next = Math.min(max, (Number(input.value) || 0) + 1);
    input.value = `${next}`;
    emitValue();
  });
  down.addEventListener("click", (event) => {
    event.stopPropagation();
    const next = Math.max(0, (Number(input.value) || 0) - 1);
    input.value = `${next}`;
    emitValue();
  });
  input.addEventListener("click", (event) => event.stopPropagation());
  controls.append(up, down);
  field.append(controls, input);
  return field;

}

function updateCharactersUi() {
  if (SERVER_RUNTIME) return;
  if (partyReorderDrag && performance.now() - partyReorderDrag.startedAt < 30000) return;
  if (!state) {
    return;
  }
  if (activeColorPicker?.picker && !activeColorPicker.picker.hidden) {
    return;
  }
  normalizeCharacterState(state);
  applyCharacterAmmoOverrides();
  syncAllCharacterEquipmentDerivedStats();
  applyCharacterColorOverrides();
  ensureCharacterPresentation();
  ui.charactersList.innerHTML = "";
  if (isCombatActive()) {
    const entry = getCurrentCombatEntry();
    if (entry?.type === 'character' && state.activeCharacterId !== entry.id &&
        !(isFloatingDisc(getActiveCharacter(state)) && getActiveCharacter(state).summon.casterId === entry.id)) {
      state.activeCharacterId = entry.id;
      syncPlayerToActiveCharacter();
    }
  } else if (isSharedRoom() && !multiplayerSession.owned_character_ids?.includes(state.activeCharacterId)) state.activeCharacterId = multiplayerSession.owned_character_ids?.[0] || null;
  ui.charactersEmpty.hidden = state.characters.length > 0;
  const order = localCharacterOrder();
  const orderedCharacters = [...state.characters].sort((a, b) => {
    const index = (id) => order.includes(id) ? order.indexOf(id) : order.length;
    return index(a.id) - index(b.id);
  });
  for (const character of orderedCharacters) {
    const card = renderCharacterCard(character);
    card.dataset.characterId = character.id;
    card.draggable = false;
    card.classList.toggle("is-readonly", !canControlCharacter(character));
    if (!canControlCharacter(character) || (isCombatActive() && !isCurrentCharacterTurn(character))) for (const control of card.querySelectorAll("input, select, button:not(.character-reorder-handle):not(.spellcasting-menu-button):not(.wake-button):not(.mini-sheet-open)")) control.disabled = true;
    ui.charactersList.append(card);
  }
  ui.characterDetail.hidden = true;
  ui.characterDetail.innerHTML = "";
  updateSelectedPartyControls();
}

function openCharacterSheet(character) {
  if (!ui.characterSheetModal || !ui.characterSheetContent) {
    return;
  }
  const currentCharacter = getCurrentCharacter(character);
  if (!currentCharacter) {
    return;
  }
  renderCharacterDetail(currentCharacter, ui.characterSheetContent, { popout: true });
  ui.characterSheetModal.hidden = false;
  positionCharacterSheetModal();
}

function openCorpseSheet(corpse) {
  renderCharacterDetail(corpse.characterCorpse,ui.characterSheetContent,{popout:true});
  for(const control of ui.characterSheetContent.querySelectorAll('button:not(.sd-sheet-icon),input,select,textarea'))control.disabled=true;
  ui.characterSheetModal.hidden=false;positionCharacterSheetModal();
}

function buryCorpse(entityId) {
  const corpse=state.entities.find(entity=>entity.id===entityId&&entity.subtype==='character-corpse');
  if(!corpse)throw new Error('This corpse is no longer here.');
  state.entities=state.entities.filter(entity=>entity.id!==entityId);
  state.characters=state.characters.filter(character=>character.id!==corpse.characterCorpse.id);
  setStatus(`${corpse.characterCorpse.name} has been buried.`);markRunDirty();updatePanels();render();
}

function setCharacterMoneyFromCopper(character, copperValue) {
  const totalCopper = Math.max(0, Math.floor(Number(copperValue) || 0));
  setCharacterMoneyValue(character, "gold", Math.floor(totalCopper / 100));
  setCharacterMoneyValue(character, "silver", Math.floor((totalCopper % 100) / 10));
  setCharacterMoneyValue(character, "copper", totalCopper % 10);
}

function ensurePartyAssets() {
  state.partyAssets = state.partyAssets || { gold: 0, silver: 0, copper: 0 };
  state.partyAssets.gold = Math.max(0, Math.floor(Number(state.partyAssets.gold || 0) || 0));
  state.partyAssets.silver = Math.max(0, Math.floor(Number(state.partyAssets.silver || 0) || 0));
  state.partyAssets.copper = Math.max(0, Math.floor(Number(state.partyAssets.copper || 0) || 0));
  return state.partyAssets;
}

function getMoneyCopper(money = {}) {
  return Math.max(0, Number(money.gold || 0)) * 100
    + Math.max(0, Number(money.silver || 0)) * 10
    + Math.max(0, Number(money.copper || 0));
}

function setMoneyFromCopper(target, copperValue) {
  const next = getMoneyFromCopper(copperValue);
  target.gold = next.gold;
  target.silver = next.silver;
  target.copper = next.copper;
  return target;
}

function addPartyAssetsCopper(copperValue) {
  const assets = ensurePartyAssets();
  return setMoneyFromCopper(assets, getMoneyCopper(assets) + Math.max(0, Math.floor(Number(copperValue) || 0)));
}

function formatMoneyParts(money = {}) {
  return `${Math.max(0, Math.floor(Number(money.gold || 0) || 0))} gp, ${Math.max(0, Math.floor(Number(money.silver || 0) || 0))} sp, ${Math.max(0, Math.floor(Number(money.copper || 0) || 0))} cp`;
}

function updatePartyAssetsUi() {
  if (!ui.partyAssetsSummary || !state) {
    return;
  }
  const assets = ensurePartyAssets();
  ui.partyAssetsSummary.textContent = `Party Assets: ${assets.gold || 0} Gold`;
  ui.partyAssetsSummary.title = formatMoneyParts(assets);
}

function isLivingCharacter(character) {
  return character && character.dead !== true && character.slain !== true && Number(character.hp || 0) > 0;
}

function awardXpFromSoldTreasure(totalCopper) {
  const living = (state.characters || []).filter(character => isLivingCharacter(character) && !character.companion && !character.summon);
  if (!living.length) {
    return { awarded: 0, livingCount: 0 };
  }
  const xpEach = Math.max(0, Number(totalCopper || 0)) / 10000 / living.length;
  let visibleAward = 0;
  for (const character of living) {
    const nextHidden = Math.max(0, Number(character.hiddenXp || character.raw?.hiddenXp || 0) || 0) + xpEach;
    const wholeXp = Math.floor(nextHidden);
    character.hiddenXp = nextHidden - wholeXp;
    const wasAvailable = canLevelUp(character);
    if (awardExperience(character, wholeXp) && !wasAvailable) pushDiceHistory('Level up available', `${character.name} has enough XP to level up.`, character.id);
    character.partyAssetShareCopper = Math.max(0, Number(character.partyAssetShareCopper || 0) || 0) + (Number(totalCopper || 0) / living.length);
    character.raw = character.raw || {};
    character.raw.hiddenXp = character.hiddenXp;
    character.raw.XP = character.XP;
    character.raw.xp = character.XP;
    character.raw.partyAssetShareCopper = character.partyAssetShareCopper;
    visibleAward = Math.max(visibleAward, wholeXp);
  }
  return { awarded: visibleAward, livingCount: living.length };
}

function normalizeItemNameForValue(name) {
  return String(name || "")
    .toLowerCase()
    .replace(/\sx\s*\d+$/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

function getRulesItemValueGp(name) {
  const normalized = normalizeItemNameForValue(name);
  const tables = [rulesData?.gear, rulesData?.armor, rulesData?.weapons];
  for (const table of tables) {
    const found = (Array.isArray(table) ? table : []).find((item) => normalizeItemNameForValue(item.name) === normalized);
    if (found) {
      return Math.max(0, Number(found.costGp || 0) || 0);
    }
  }
  return 0;
}

function getGearItemValueCopper(item) {
  if (item?.magic?.pricePending) return 0;
  const magicValue = magicSaleValue(item);
  if (magicValue !== null) return Math.round(magicValue * 100);
  const directGp = Number(item?.value ?? item?.costGp ?? item?.cost ?? NaN);
  const baseGp = Number.isFinite(directGp) ? Math.max(0, directGp) : getRulesItemValueGp(item?.name);
  const units = item?.treasureItem === true ? 1 : Math.max(1, Number(item?.totalUnits ?? item?.quantity ?? 1) || 1);
  return Math.round(baseGp * units * 100);
}

function performMagicGearAction(type, character, index, targetId = null) {
  if (sendSharedCommand(type, { gear_index: index, target_id: targetId }, character)) {
    if (type === 'read_scroll' || type === 'read_wand') ui.spellDetailModal.hidden = true;
    return;
  }
  let caster = getCurrentCharacter(character);
  try {
    if (!Number.isInteger(index) || !caster?.gear?.[index] || !canControlCharacter(caster) || !isCharacterAbleToAct(caster)) throw new Error('This character cannot use that item now.');
    if (!pendingSpellAllowsCommand(caster, type)) throw new Error(pendingSpellMessage(caster));
    let outcome;
    if (type === 'drink_potion') outcome = drinkPotion(caster, index);
    else if (type === 'learn_scroll') outcome = queueScrollLearning(caster, index);
    else if (type === 'identify') {
      if (!canIdentify(caster) || !caster.gear[index].magic || caster.gear[index].magic.identified) throw new Error('Choose an unidentified magic item while Detect Magic is available.');
      if (!SERVER_RUNTIME && !consumeCharacterCombatAction(caster)) return;
      outcome = identifyGear(state, caster, index, { advantage: characterHasSpellCastingAdvantage(caster, findSpellRecord('detect magic')), disadvantage: protectionDisadvantage(state, caster) });
      for (const result of outcome.checks) pushDiceHistory('Identify check', result.message, caster.id);
    } else if (type === 'read_scroll' || type === 'read_wand') {
      if (caster.companion?.kind === 'doppelganger') throw new Error('This creature cannot cast spells.');
      const item = caster.gear[index], spell = findSpellRecord(item.magic?.spellName);
      const casterClass = /wizard/i.test(caster.className) ? 'wizard' : /priest/i.test(caster.className) ? 'priest' : '';
      const wand = type === 'read_wand';
      if (item.magic?.kind !== (wand ? 'wand' : 'scroll') || !spell || !spell.classes.includes(casterClass)) throw new Error('That magic item is not on this caster\'s spell list.');
      if (wand && item.magic.disabledUntilRest) throw new Error('This wand cannot be used again until its caster completes a successful rest.');
      if (blocksSpellTier(caster, spell.tier)) throw new Error('A wizard mishap blocks this spell tier until a successful rest.');
      if (forgottenSpells(caster).has(getSpellKey(spell))) throw new Error('The ability to cast this spell was permanently lost.');
      if (getSpellKey(spell) === 'cure wounds') validateCureWoundsTarget(state, caster, targetId);
      if (getSpellKey(spell) === 'feather fall' && !caster.pendingFall) throw new Error('Read Feather Fall when falling.');
      if (getSpellKey(spell) === 'floating disc' && !floatingDiscSlotsAvailable(state)) throw new Error('Floating Disc needs a free party slot.');
      if (getSpellKey(spell) === 'alarm') {
        if (isCombatActive() || restInProgress(state)) throw new Error('Read Alarm while preparing rest, outside combat.');
        restingParty(state);
      }
      const key = getSpellKey(spell), failed = [...caster.failedSpellKeys], lock = caster.spellLocks[key], penance = caster.spellPenance[key];
      caster.failedSpellKeys = caster.failedSpellKeys.filter(name => name !== key);
      delete caster.spellLocks[key]; delete caster.spellPenance[key];
      item.instanceId ||= `spell-item-${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
      if (!wand) caster.gear[index] = { name: 'Blank paper', slots: 1, quantity: 1, totalUnits: 1, value: 1, type: 'sundry' };
      caster.castingScroll = true;
      const capture = { characterId: caster.id, check: null }; activeItemCast = capture;
      try { performSpellCast(caster, spell, targetId); }
      finally {
        activeItemCast = null; caster = getCurrentCharacter(caster);
        caster.castingScroll = false;
        caster.failedSpellKeys = [...new Set([...failed, ...caster.failedSpellKeys.filter(name => name !== key)])];
        if (lock) caster.spellLocks[key] = lock; else delete caster.spellLocks[key];
        if (penance) caster.spellPenance[key] = penance; else delete caster.spellPenance[key];
      }
      if (wand && capture.check?.roll === 1) {
        caster.gear = caster.gear.filter(gear => gear.instanceId !== item.instanceId);
        caster.raw.gear = structuredClone(caster.gear);
        setStatus(`${ui.statusText.textContent} The wand is destroyed.`);
      } else if (wand && capture.check && capture.check.roll !== 20 && (capture.check.roll === 1 || capture.check.total < 10 + spell.tier)) {
        const currentWand = caster.gear.find(gear => gear.instanceId === item.instanceId);
        if (currentWand) currentWand.magic.disabledUntilRest = true;
        setStatus(`${ui.statusText.textContent} This wand is disabled until a successful rest.`);
      }
      if (!SERVER_RUNTIME) ui.spellDetailModal.hidden = true;
      outcome = { message: ui.statusText.textContent };
    } else throw new Error('Unknown magic item action.');
    syncAllCharacterEquipmentDerivedStats(); syncPlayerLightFromActiveCharacter(); recomputeVisibility(state);
    prepareEncounterState(); markRunDirty(); markUserActivity(); setStatus(outcome.message);
    checkCombatEnd();
    pushDiceHistory(type === 'learn_scroll' ? 'Scroll study' : 'Magic item', outcome.message, caster.id);
    if (type === 'learn_scroll' && !SERVER_RUNTIME) showNotice(outcome.message);
    refreshCharacterViews(caster); syncCriticalSpellDialog(); updatePanels(); render();
  } catch (error) { if (SERVER_RUNTIME) throw error; setStatus(error.message); }
}

function showNotice(message) {
  if (SERVER_RUNTIME) return;
  let modal = document.getElementById('magic-notice-modal');
  if (!modal) {
    modal = document.createElement('div'); modal.id = 'magic-notice-modal'; modal.className = 'modal-backdrop'; modal.hidden = true;
    const card = document.createElement('section'); card.className = 'modal-card'; card.setAttribute('role', 'dialog'); card.setAttribute('aria-modal', 'true'); card.setAttribute('aria-label', 'Magic item result');
    const text = document.createElement('p');
    const button = document.createElement('button'); button.type = 'button'; button.textContent = 'Close';
    button.onclick = () => { modal.hidden = true; };
    card.append(text, button); modal.append(card); document.body.append(modal);
  }
  modal.querySelector('p').textContent = message; modal.hidden = false; modal.querySelector('button').focus();
}

function advancementContext() {
  const spells = [...spellLookup.values()];
  return { spells, weapons: rulesData?.weapons || [], createMagicItem: (kind, character) => createTalentMagicItem(kind, character, { rules: rulesData, spells }), get magicItems() { return [
    { item: magicPotion('healing-1'), weight: 15 }, ...magicTreasureCatalog(rulesData, spells, state.level || 1)
  ]; } };
}

function applyAdvancementChoice(character, eventId, taskId, value) {
  character = getCurrentCharacter(character);
  if (!character || !ownsCharacter(character) || isCombatActive() || restInProgress(state)) throw new Error('Finish level-up choices outside combat and rest.');
  const result = resolveAdvancement(character, eventId, taskId, value, advancementContext());
  if (result.createdItem) {
    if (getCharacterGearFreeSlots(character) >= (result.createdItem.slots || 1)) character.gear.push(result.createdItem);
    else state.entities.push(createDroppedGearEntity(result.createdItem, character));
    character.raw.gear = JSON.parse(JSON.stringify(character.gear));
  }
  syncCharacterEquipmentDerivedStats(character);
  markRunDirty(); markUserActivity();
  setStatus(`${character.name}'s level-up choice is saved.`);
}

function startCharacterLevelUp(character) {
  if (!character || !ownsCharacter(character) || isCombatActive() || restInProgress(state)) throw new Error('Level up outside combat and rest.');
  const event = beginLevelUp(character);
  pushDiceHistory('Level up', `${character.name} reaches level ${event.level}. HP: ${event.hpRolls.join(', ')} + CON = +${event.hpGain} maximum HP.`, character.id);
  syncCharacterEquipmentDerivedStats(character); markRunDirty(); markUserActivity();
  setStatus(`${character.name} reaches level ${event.level}.`);
}

async function openAdvancement(characterId) {
  if (SERVER_RUNTIME) return;
  let character = state.characters.find(member => member.id === characterId);
  try {
    if (canLevelUp(character)) {
      if (isSharedRoom()) await executeSharedCommand({ type: 'level_up', character_id: characterId });
      else { startCharacterLevelUp(character); refreshCharacterViews(character); render(); }
    }
  } catch (error) { setStatus(error.message); return; }
  character = state.characters.find(member => member.id === characterId);
  let modal = document.getElementById('advancement-modal');
  if (!modal) {
    modal = document.createElement('div'); modal.id = 'advancement-modal'; modal.className = 'modal-backdrop';
    const card = document.createElement('section'); card.className = 'modal-card'; card.setAttribute('role', 'dialog'); card.setAttribute('aria-modal', 'true');
    card.setAttribute('aria-labelledby', 'advancement-title');
    modal.append(card); document.body.append(modal);
    modal.addEventListener('keydown', event => { if (event.key === 'Escape') { event.stopPropagation(); modal.hidden = true; } });
  }
  modal.dataset.characterId = characterId;
  modal.dataset.eventId = character.advancements?.find(event => !event.completed)?.id || character.advancements?.at(-1)?.id || '';
  delete modal.dataset.renderKey; modal.hidden = false;
  renderAdvancement();
}

async function submitAdvancementChoice(character, event, task, value, button) {
  button.disabled = true;
  try {
    character = getCurrentCharacter(character);
    if (isSharedRoom()) await executeSharedCommand({ type: 'advance_choice', character_id: character.id, event_id: event.id, task_id: task.id, value });
    else { applyAdvancementChoice(character, event.id, task.id, value); refreshCharacterViews(character); render(); }
    renderAdvancement();
  } catch (error) { setStatus(error.message); button.disabled = false; }
}

function renderAdvancement() {
  const modal = document.getElementById('advancement-modal');
  if (!modal || modal.hidden) return;
  const character = state.characters.find(member => member.id === modal.dataset.characterId);
  const event = character?.advancements?.find(entry => !entry.completed) || character?.advancements?.find(entry => entry.id === modal.dataset.eventId);
  if (!event || !ownsCharacter(character) || isCombatActive() || restInProgress(state)) { modal.hidden = true; return; }
  const key = JSON.stringify([character.id, event, character.stats, character.spellsKnown, sharedCommandPending]);
  if (modal.dataset.renderKey === key) return;
  modal.dataset.renderKey = key;
  const card = modal.firstElementChild; card.replaceChildren();
  const heading = document.createElement('h2'); heading.id = 'advancement-title'; heading.textContent = `${character.name}: ${event.initial ? /fighter/i.test(character.className) ? 'Pick Talent' : 'Pick Spells' : `Level ${event.level}`}`;
  const summary = document.createElement('p'); summary.textContent = `Title: ${character.title}. Maximum HP +${event.hpGain} (${event.hpRolls.join(', ')} ${formatModifier(event.conModifier)} CON).${event.talentRoll ? ` Talent: 2d6 = ${event.talentRoll.rolls.join(' + ')} = ${event.talentRoll.total}.` : ''}`;
  card.append(heading); if (!event.initial) card.append(summary);
  for (const bonus of character.bonuses.filter(bonus => bonus.progression && bonus.gainedAtLevel === event.level)) {
    const result = document.createElement('p'); result.textContent = bonus.description; card.append(result);
  }
  const context = advancementContext(), spellGroups = new Set();
  const submit = (task, value, button) => { void submitAdvancementChoice(character, event, task, value, button); };
  const addHeading = text => { const h = document.createElement('h3'); h.textContent = text; card.append(h); };
  const statRows = (task, values, enabled, points = false) => {
    for (const value of values) {
      const row = document.createElement('div'); row.className = 'advancement-stat'; row.classList.toggle('is-inactive', !enabled);
      const score = Number(character.stats[value]) || 10, modifier = abilityScoreModifier(score);
      const label = document.createElement(enabled && !points ? 'button' : 'span');
      label.textContent = `${STAT_NAMES[value]} ${score}: [${modifier > 0 ? '+' : ''}${modifier}]`;
      if (enabled && !points) { label.type = 'button'; label.addEventListener('click', () => submit(task, value, label)); }
      row.append(label);
      if (enabled && points) {
        const pick = document.createElement('button'); pick.type = 'button'; pick.textContent = 'Pick';
        pick.disabled = sharedCommandPending > 0; pick.addEventListener('click', () => submit(task, value, pick)); row.append(pick);
      }
      if (score >= 18) { const warning = document.createElement('em'); warning.textContent = 'No additional benefit from raising this score.'; row.append(warning); }
      card.append(row);
    }
  };
  const choices = (task, options, enabled = true) => {
    const list = document.createElement('div'); list.className = 'advancement-spells'; list.classList.toggle('is-inactive', !enabled);
    for (const option of options) {
      const row = document.createElement('div'); row.className = 'advancement-spell'; row.dataset.choiceValue = option.value;
      const name = document.createElement('button'); name.type = 'button'; name.className = 'advancement-spell-name'; name.textContent = option.label;
      const pick = document.createElement('button'); pick.type = 'button'; pick.textContent = 'Pick';
      name.disabled = pick.disabled = !enabled || sharedCommandPending > 0;
      if (task.type === 'grit') name.title = GRIT_DESCRIPTIONS[option.value];
      if (task.type === 'casting-or-int' && option.value === 'INT') {
        const score = character.stats.INT; name.textContent = `Intelligence ${score}: [${formatModifier(abilityScoreModifier(score))}] (+2)`;
        if (score >= 18) { const warning = document.createElement('em'); warning.textContent = 'No additional benefit from raising this score.'; row.append(warning); }
      }
      name.addEventListener('click', () => submit(task, option.value, name)); pick.addEventListener('click', () => submit(task, option.value, pick));
      row.prepend(name); row.append(pick); list.append(row);
    }
    card.append(list);
  };
  for (const task of event.tasks.filter(entry => !entry.done)) {
    if (['spell','extra-spell','spell-advantage'].includes(task.type)) {
      if (event.initial && task.type !== 'spell' && event.tasks.some(entry => entry.type === 'spell' && !entry.done)) continue;
      const group = `${task.type}:${task.tier || ''}`; if (spellGroups.has(group)) continue; spellGroups.add(group);
      const peers = event.tasks.filter(entry => `${entry.type}:${entry.tier || ''}` === group);
      const remaining = peers.filter(entry => !entry.done).length;
      const title = document.createElement('h3'); title.textContent = task.type === 'spell-advantage' ? 'Choose a spell for advantage' : `Choose ${remaining} ${task.tier ? `Tier ${task.tier} ` : 'extra '}${remaining === 1 ? 'spell' : 'spells'}`;
      const list = document.createElement('div'); list.className = 'advancement-spells';
      const selected = peers.filter(entry => entry.done).map(entry => entry.choice);
      const options = [...advancementOptions(character, event, task, context), ...selected.map(value => ({ value }))].sort((a,b) => a.value.localeCompare(b.value));
      for (const option of options) {
        const row = document.createElement('div'); row.className = 'advancement-spell';
        const name = document.createElement('button'); name.type = 'button'; name.className = 'advancement-spell-name'; name.textContent = option.value;
        name.addEventListener('click', () => renderSpellDetail(findSpellRecord(option.value), getCurrentCharacter(character), { readOnly: true }));
        const picked = selected.includes(option.value); row.classList.toggle('is-picked', picked);
        const pick = document.createElement('button'); pick.type = 'button'; pick.textContent = picked ? 'Picked' : 'Pick'; pick.disabled = picked || sharedCommandPending > 0;
        pick.addEventListener('click', () => { void submitAdvancementChoice(character, event, task, option.value, pick); });
        row.append(name, pick); list.append(row);
      }
      card.append(title, list); continue;
    }
    if (task.type === 'wild') {
      const points = document.createElement('button'); points.type = 'button'; points.textContent = '+2 points to distribute to stats'; points.disabled = task.mode === 'talents';
      points.addEventListener('click', () => submit(task, 'points', points)); card.append(points);
      statRows(task, Object.keys(STAT_NAMES), false);
      const talents = document.createElement('button'); talents.type = 'button'; talents.textContent = 'Pick a talent'; talents.disabled = task.mode === 'talents';
      talents.addEventListener('click', () => submit(task, 'talents', talents)); card.append(talents);
      choices(task, advancementOptions(character,event,task,context).filter(option => !['points','talents'].includes(option.value)), task.mode === 'talents');
      continue;
    }
    if (task.type === 'stat' || task.type === 'points') {
      addHeading(task.type === 'points' ? `${task.remaining ?? 2} stat points remaining` : 'Choose a stat: +2');
      statRows(task, advancementOptions(character,event,task,context).map(option => option.value), true, task.type === 'points');
      if (task.fromWild) choices({ ...task, type: 'wild' }, advancementOptions(character,event,{type:'wild'},context).filter(option=>!['points','talents'].includes(option.value)), false);
      continue;
    }
    addHeading(({mastery:'Choose weapon mastery:',grit:'Pick your grit:',armor:'Choose an armor category:', 'magic-item':'Choose a magic item type:'})[task.type] || 'Choose a talent benefit');
    choices(task, advancementOptions(character,event,task,context));
  }
  const close = document.createElement('button'); close.type = 'button'; close.textContent = event.completed ? 'Close' : 'Pick Later'; close.onclick = () => { modal.hidden = true; };
  card.append(close);
}

function syncAdvancementUi() {
  renderAdvancement();
}

function answerFall(character, attempt) {
  if (isSharedRoom()) {
    void executeSharedCommand({ type: 'fall_response', character_id: character.id, attempt }).catch(() => {});
    return;
  }
  try {
    const outcome = resolveFallingDamage(state, character, attempt, { disadvantage: protectionDisadvantage(state, character),
      advantage: characterHasSpellCastingAdvantage(character, findSpellRecord('feather fall')) });
    if (isCurrentCharacterTurn(character) && !isCharacterAbleToAct(character)) {
      state.combat.movementRemaining = 0; state.combat.actionUsed = true;
    }
    setStatus(outcome.message); pushDiceHistory('Falling', outcome.message, character.id);
    syncAllCharacterEquipmentDerivedStats(); checkCombatEnd(); markRunDirty(); updatePanels(); render(); scheduleAutoEndTurnIfNeeded();
  } catch (error) { if (SERVER_RUNTIME) throw error; setStatus(error.message); }
}

function syncFallingUi() {
  if (SERVER_RUNTIME) return;
  let modal = document.getElementById('falling-modal');
  if (!modal) {
    modal = document.createElement('div'); modal.className = 'modal-backdrop'; modal.id = 'falling-modal'; modal.hidden = true;
    const card = document.createElement('section'); card.className = 'modal-card'; card.setAttribute('role', 'dialog'); card.setAttribute('aria-modal', 'true'); card.setAttribute('aria-label', 'Feather Fall');
    const text = document.createElement('p'), yes = document.createElement('button'), no = document.createElement('button');
    yes.type = no.type = 'button'; yes.textContent = 'Yes'; no.textContent = 'No';
    yes.onclick = () => answerFall(state.characters.find(character => character.id === modal.dataset.characterId), true);
    no.onclick = () => answerFall(state.characters.find(character => character.id === modal.dataset.characterId), false);
    card.append(text, yes, no); modal.append(card); document.body.append(modal);
  }
  const character = state.characters.find(character => character.pendingFall && ownsCharacter(character));
  modal.hidden = !character;
  if (!character) return;
  modal.dataset.characterId = character.id;
  modal.querySelector('p').textContent = `${character.name} is falling. Cast Feather Fall?`;
  const color = getCharacterColorValue(character);
  modal.querySelector('.modal-card').style.borderColor = color;
  modal.querySelector('button').disabled = !isCharacterAbleToAct(character) || !canCastFeatherFall(character) || sharedCommandPending > 0;
}

function addMagicGearControls(row, character, index) {
  const item = character.gear[index];
  if (!item?.magic) return;
  const controls = document.createElement('span'); controls.className = 'sd-magic-gear-controls';
  const add = (label, type, enabled = true) => {
    const button = document.createElement('button'); button.type = 'button'; button.textContent = label;
    button.disabled = !enabled || !canControlCharacter(character) || !isCharacterAbleToAct(character);
    if (type === 'read_wand' && item.magic.disabledUntilRest) button.title = 'This wand needs a successful rest before it can be used again.';
    button.addEventListener('click', event => {
      event.stopPropagation();
      if (type === 'read_scroll' || type === 'read_wand') {
        const spell = findSpellRecord(item.magic.spellName);
        if (!item.magic.identified) performMagicGearAction(type, character, index, character.id);
        else { renderSpellDetail(spell, character, { scrollIndex: index }); ui.spellDetailModal.hidden = false; }
      } else performMagicGearAction(type, character, index);
    }); controls.append(button);
  };
  if (!item.magic.identified && canIdentify(character)) add('Identify', 'identify', !isCombatActive() || !state.combat.actionUsed);
  if (item.magic.kind === 'potion') add('Drink', 'drink_potion');
  if (['scroll','wand'].includes(item.magic.kind) && character.companion?.kind !== 'doppelganger') {
    const casterClass = /wizard/i.test(character.className) ? 'wizard' : /priest/i.test(character.className) ? 'priest' : '';
    if (item.magic.classes.includes(casterClass)) add(item.magic.kind === 'wand' ? 'Cast' : 'Read', item.magic.kind === 'wand' ? 'read_wand' : 'read_scroll', !item.magic.disabledUntilRest && (!isCombatActive() || !state.combat.actionUsed));
    if (item.magic.kind === 'scroll' && casterClass === 'wizard' && item.magic.identified && item.magic.classes.includes('wizard') && !String(character.spellsKnown).split(/,\s*/).includes(item.magic.spellName)) {
      add(item.magic.learnOnRest ? 'Queued' : 'Learn', 'learn_scroll', !item.magic.learnOnRest && !forgottenSpells(character).has(getSpellKey(item.magic.spellName)));
    }
  }
  if (controls.children.length) row.append(controls);
}

function closeActiveSellPanel() {
  activeSellPanel?.remove();
  activeSellPanel = null;
}

function sellCharacterTreasure(character, items, coins) {
  if (sendSharedCommand('sell_treasure', { items, coins }, character)) return;
  const current = getCurrentCharacter(character);
  if (!isCharacterInStartingRoom(current) || isCombatActive()) throw new Error('Sell treasure only in the starting room, outside combat.');
  if (!Array.isArray(items) || items.length > 100 || new Set(items.map(item => item.index)).size !== items.length) throw new Error('Invalid sale items.');
  let total = 0;
  for (const entry of items) {
    const item = current.gear[entry.index];
    if (!Number.isInteger(entry.index) || !item || item.name !== entry.name || item.bound) throw new Error('The gear list changed; reopen Sell Treasure.');
    if (item.magic?.pricePending) throw new Error('This crafted item cannot be sold until its Gold value is defined.');
    total += getGearItemValueCopper(item);
  }
  for (const denomination of ['gold','silver','copper']) {
    const amount = coins?.[denomination] ?? 0;
    if (!Number.isInteger(amount) || amount < 0 || amount > getCharacterMoney(current, denomination)) throw new Error('Invalid coin sale.');
    total += getCoinValueInCopper(denomination, amount);
  }
  const removed = new Set(items.map(item => item.index));
  current.gear = current.gear.filter((item, index) => !removed.has(index));
  for (const denomination of ['gold','silver','copper']) setCharacterMoneyValue(current, denomination, getCharacterMoney(current, denomination) - (coins?.[denomination] || 0));
  current.raw.gear = structuredClone(current.gear);
  addPartyAssetsCopper(total);
  const xp = awardXpFromSoldTreasure(total);
  normalizeCharacterState(state); syncAllCharacterEquipmentDerivedStats(); ensureCharacterPresentation();
  markRunDirty(); markUserActivity(); updatePanels(); render();
  setStatus(`Sold treasure for ${formatMoneyParts(getMoneyFromCopper(total))}.${xp.livingCount ? ` XP checked for ${xp.livingCount} living characters.` : ''}`);
}

function openSellTreasurePanel(character, anchor) {
  closeActiveShopPanel();
  closeActiveSellPanel();
  const currentCharacter = getCurrentCharacter(character);
  if (!currentCharacter || !isCharacterInStartingRoom(currentCharacter)) {
    return;
  }
  const draft = {
    gear: JSON.parse(JSON.stringify(currentCharacter.gear || [])),
    gearIndices: (currentCharacter.gear || []).map((item,index) => index),
    soldItems: [],
    money: {
      gold: getCharacterMoney(currentCharacter, "gold"),
      silver: getCharacterMoney(currentCharacter, "silver"),
      copper: getCharacterMoney(currentCharacter, "copper")
    },
    saleCopper: 0
  };
  const panel = document.createElement("section");
  panel.className = "sd-shop-popover sd-sell-popover";

  const renderDraft = () => {
    panel.innerHTML = "";
    const heading = createShopHeading('Sell Treasure', closeActiveSellPanel);
    const assets = document.createElement("div");
    assets.className = "sd-shop-coins";
    assets.textContent = `PARTY ASSETS: ${formatMoneyParts(ensurePartyAssets()).toUpperCase()}`;
    const toSell = document.createElement("div");
    toSell.className = "sd-shop-coins";
    toSell.textContent = `To be sold: ${formatMoneyParts(getMoneyFromCopper(draft.saleCopper))}`;
    panel.append(heading, assets, toSell);

    for (const key of ["gold", "silver", "copper"]) {
      const row = document.createElement("div");
      row.className = "sd-sell-row";
      const label = document.createElement("span");
      label.textContent = key.toUpperCase();
      const amount = document.createElement("input");
      amount.type = "number";
      amount.min = "0";
      amount.max = `${draft.money[key]}`;
      amount.value = `${draft.money[key]}`;
      amount.addEventListener("change", () => {
        const next = Math.max(0, Math.min(draft.money[key], Math.floor(Number(amount.value) || 0)));
        const sold = draft.money[key] - next;
        draft.money[key] = next;
        draft.saleCopper += getCoinValueInCopper(key, sold);
        renderDraft();
      });
      const down = document.createElement("button");
      down.type = "button";
      down.textContent = "down";
      down.disabled = draft.money[key] <= 0;
      down.addEventListener("click", () => {
        if (draft.money[key] <= 0) {
          return;
        }
        draft.money[key] -= 1;
        draft.saleCopper += getCoinValueInCopper(key, 1);
        renderDraft();
      });
      row.append(label, amount, down);
      panel.append(row);
    }

    for (const [index, item] of draft.gear.entries()) {
      const valueCopper = getGearItemValueCopper(item);
      const row = document.createElement("div");
      row.className = "sd-sell-row sd-sell-row--gear";
      const label = document.createElement("span");
      label.textContent = getGearDisplayName(item);
      const value = document.createElement("span");
      value.textContent = item.magic?.pricePending ? 'Value pending' : formatTreasureValue(valueCopper / 100);
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = "sell";
      button.disabled = Boolean(item.bound || item.magic?.pricePending);
      if (item.magic?.pricePending) button.title = 'Gold value has not been defined for this crafted item.';
      button.addEventListener("click", () => {
        draft.saleCopper += valueCopper;
        draft.soldItems.push({ index: draft.gearIndices[index], name: item.name });
        draft.gear.splice(index, 1);
        draft.gearIndices.splice(index, 1);
        renderDraft();
      });
      row.append(label, value, button);
      panel.append(row);
    }

    const actions = document.createElement("div");
    actions.className = "sd-sell-actions";
    const sell = document.createElement("button");
    sell.type = "button";
    sell.textContent = "Sell";
    sell.disabled = draft.saleCopper <= 0;
    sell.addEventListener("click", () => {
      try {
        sellCharacterTreasure(currentCharacter, draft.soldItems, Object.fromEntries(['gold','silver','copper'].map(key => [key,getCharacterMoney(currentCharacter,key)-draft.money[key]])));
        closeActiveSellPanel();
      } catch(error) { setStatus(error.message); }
    });
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.textContent = "Cancel";
    cancel.addEventListener("click", closeActiveSellPanel);
    actions.append(sell, cancel);
    panel.append(actions);
  };

  renderDraft();
  document.body.append(panel);
  const anchorRect = anchor?.getBoundingClientRect?.() || getCharacterSheetCard()?.getBoundingClientRect();
  const panelRect = panel.getBoundingClientRect();
  const left = Math.min(window.innerWidth - panelRect.width - 12, Math.max(12, anchorRect.left));
  const top = Math.min(window.innerHeight - panelRect.height - 12, Math.max(12, anchorRect.bottom + 6));
  panel.style.left = `${left}px`;
  panel.style.top = `${top}px`;
  activeSellPanel = panel;
}

function closeCharacterSheet() {
  if (!ui.characterSheetModal) {
    return;
  }
  closeActiveShopPanel();
  closeActiveSellPanel();
  ui.characterSheetModal.hidden = true;
  characterSheetDrag = null;
}

function getCharacterSheetCard() {
  return ui.characterSheetModal?.querySelector(".character-sheet-modal") || null;
}

function clampCharacterSheetPosition(left, top) {
  const card = getCharacterSheetCard();
  if (!card) {
    return { left, top };
  }
  const margin = 12;
  const rect = card.getBoundingClientRect();
  const maxLeft = Math.max(margin, window.innerWidth - rect.width - margin);
  const maxTop = Math.max(margin, window.innerHeight - rect.height - margin);
  return {
    left: Math.max(margin, Math.min(maxLeft, left)),
    top: Math.max(margin, Math.min(maxTop, top))
  };
}

function positionCharacterSheetModal() {
  const card = getCharacterSheetCard();
  if (!card) {
    return;
  }
  const sheet = card.querySelector('.character-sheet');
  if (sheet) {
    const width = sheet.offsetWidth;
    const height = sheet.offsetHeight;
    const scale = Math.min(1, (window.innerWidth - 24) / width, (window.innerHeight - 48) / height);
    card.style.width = `${width}px`;
    card.style.transformOrigin = 'top left';
    card.style.transform = `scale(${Math.max(.1, scale)})`;
  }
  const rect = card.getBoundingClientRect();
  const fallback = {
    left: Math.max(12, (window.innerWidth - rect.width) / 2),
    top: 24
  };
  const position = characterSheetPosition || fallback;
  characterSheetPosition = clampCharacterSheetPosition(position.left, position.top);
  card.style.left = `${characterSheetPosition.left}px`;
  card.style.top = `${characterSheetPosition.top}px`;
}

function startCharacterSheetDrag(event) {
  const card = getCharacterSheetCard();
  if (!card || event.pointerType==='touch' || event.button !== 0 || event.target.closest("button, input, textarea, select, a, [data-gear-index]")) {
    return;
  }
  const rect = card.getBoundingClientRect();
  characterSheetDrag = {
    pointerId: event.pointerId,
    offsetX: event.clientX - rect.left,
    offsetY: event.clientY - rect.top
  };
  card.classList.add("is-dragging");
  card.setPointerCapture?.(event.pointerId);
  event.preventDefault();
}

function dragCharacterSheet(event) {
  if (!characterSheetDrag) {
    return;
  }
  characterSheetPosition = clampCharacterSheetPosition(
    event.clientX - characterSheetDrag.offsetX,
    event.clientY - characterSheetDrag.offsetY
  );
  const card = getCharacterSheetCard();
  if (card) {
    card.style.left = `${characterSheetPosition.left}px`;
    card.style.top = `${characterSheetPosition.top}px`;
  }
}

function stopCharacterSheetDrag() {
  if (!characterSheetDrag) {
    return;
  }
  const card = getCharacterSheetCard();
  card?.releasePointerCapture?.(characterSheetDrag.pointerId);
  card?.classList.remove("is-dragging");
  characterSheetDrag = null;
}

function createSheetField(label, value, options = {}) {
  const field = document.createElement("div");
  field.className = "sheet-field";
  const fieldLabel = document.createElement("div");
  fieldLabel.className = "sheet-field-label";
  fieldLabel.textContent = label;
  const fieldValue = options.editable ? document.createElement("input") : document.createElement("div");
  fieldValue.className = "sheet-field-value";
  if (options.editable) {
    fieldValue.type = "number";
    fieldValue.min = options.min ?? "0";
    fieldValue.max = options.max ?? "99";
    fieldValue.value = `${value ?? ""}`;
    fieldValue.addEventListener("change", () => {
      if (typeof options.onChange === "function") {
        options.onChange(fieldValue);
      }
    });
  } else {
    fieldValue.textContent = `${value ?? ""}`;
  }
  field.append(fieldLabel, fieldValue);
  return field;
}

function readBaseClassesOnlyPreference() {
  try {
    const storedValue = window.localStorage.getItem(BASE_CLASSES_ONLY_STORAGE_KEY);
    return storedValue === null ? true : storedValue === "true";
  } catch {
    return true;
  }
}

function writeBaseClassesOnlyPreference(isEnabled) {
  try {
    window.localStorage.setItem(BASE_CLASSES_ONLY_STORAGE_KEY, isEnabled ? "true" : "false");
  } catch {
    // Ignore storage failures in private browsing or locked-down environments.
  }
}

function syncBaseClassesOnlyToggleState(isEnabled) {
  if (!ui.baseClassesOnlyToggle) {
    return;
  }
  ui.baseClassesOnlyToggle.checked = Boolean(isEnabled);
  writeBaseClassesOnlyPreference(Boolean(isEnabled));
}

function getBaseClassesOnlyToggleState() {
  return true;
}

async function setShadowdarklingsSourceSwitches(page, enabled) {
  for (const label of SHADOWDARKLINGS_SOURCE_SWITCHES) {
    const switchControl = page.getByRole("switch", { name: label });
    try {
      await switchControl.setChecked(enabled);
    } catch (error) {
      console.warn(`Unable to set ShadowDarklings source switch "${label}" to ${enabled ? "on" : "off"}.`, error);
    }
  }
}

async function importShadowdarklingsCharacterOneClick() {
  if (!state) {
    ui.charactersEmpty.hidden = false;
    ui.charactersEmpty.textContent = "Generate a dungeon first, then import characters.";
    return;
  }

  const availableSlots = floatingDiscSlotsAvailable(state);
  if (!availableSlots) {
    ui.charactersEmpty.hidden = false;
    ui.charactersEmpty.textContent = "Maximum of 16 active characters reached.";
    return;
  }

  if (!canUseRoomCharacterImport()) {
    const message = multiplayerSession.options?.players_can_import
      ? "You already control a character in this dungeon."
      : "The host is assigning characters for this dungeon.";
    ui.charactersEmpty.hidden = false;
    ui.charactersEmpty.textContent = message;
    setStatus(message);
    return;
  }

  const importButton = ui.importCharacterBtn;
  const previousLabel = importButton?.textContent || "Import from ShadowDarklings";
  if (importButton) {
    importButton.dataset.busy = "true";
    importButton.disabled = true;
    importButton.textContent = "Importing...";
  }

  ui.charactersEmpty.hidden = false;
  ui.charactersEmpty.textContent = "A new character from ShadowDarklings enters the dungeon.";

  try {
    const characterJson = await importShadowdarklingsCharacter({
      baseClassesOnly: getBaseClassesOnlyToggleState(),
      roomId: multiplayerSession.id
    });
    const characters = extractShadowdarkCharacters(characterJson);
    if (!characters.length) {
      throw new Error("ShadowDarklings did not return usable character JSON.");
    }

    const importedCharacters = characters.slice(0, availableSlots);
    if (isSharedRoom()) {
      await executeSharedCommand({ type: "import", character_json: importedCharacters[0], fresh_import: true });
      return;
    }
    for (const imported of importedCharacters) { initializeImportChoices(imported); putCharacterFirst(imported.id); }
    placeCharactersNearStartingStairs(importedCharacters);
    state.characters.push(...importedCharacters);
    for (const imported of importedCharacters) initializeImportedCharacterLight(imported);
    queueCharactersForNextCombatRound(importedCharacters);
    normalizeCharacterState(state);
    ensureCharacterPresentation();
    recomputeVisibility(state);
    const sighting = processMonsterVisibilityChange();
    state.run.dirty = true;
    markUserActivity();
    updatePanels();
    render();

    ui.charactersEmpty.hidden = state.characters.length > 0;
    ui.charactersEmpty.textContent = state.characters.length > 0 ? "" : "No characters imported yet.";
    if (!sighting?.combatStarted && !sighting?.combatEnded) {
      setStatus(`Imported ${importedCharacters.length} character${importedCharacters.length === 1 ? "" : "s"} from ShadowDarklings.`);
    }
  } catch (error) {
    ui.charactersEmpty.hidden = false;
    ui.charactersEmpty.textContent = error?.message || "ShadowDarklings import failed.";
    setStatus(ui.charactersEmpty.textContent);
  } finally {
    if (importButton) {
      delete importButton.dataset.busy;
      importButton.disabled = !canUseRoomCharacterImport();
      importButton.textContent = previousLabel;
    }
  }
}

function findSpellRecord(name) {
  const key = getSpellKey(name);
  const record = spellLookup.get(key) || null;
  return record && normalizeSpellLookupKey(name) === 'protection from good' ? { ...record, name: 'Protection from Good' } : record;
}

function getSpellKey(spellOrName) {
  const key = normalizeSpellLookupKey(typeof spellOrName === "string" ? spellOrName : spellOrName?.name);
  return key === 'protection from good' ? 'protection from evil' : key;
}

function ensureFailedSpellKeys(character) {
  if (!character) {
    return [];
  }
  if (!Array.isArray(character.failedSpellKeys)) {
    character.failedSpellKeys = [];
  }
  return character.failedSpellKeys;
}

function isCharacterSpellFailed(character, spellOrName) {
  const key = getSpellKey(spellOrName);
  const record = typeof spellOrName === 'object' ? spellOrName : findSpellRecord(key);
  return Boolean(key && (ensureFailedSpellKeys(character).includes(key) || forgottenSpells(character).has(key) || blocksSpellTier(character, record?.tier)));
}

function markCharacterSpellFailed(character, spellOrName) {
  const key = getSpellKey(spellOrName);
  if (!key || !character) {
    return;
  }
  const failedSpellKeys = ensureFailedSpellKeys(character);
  if (!failedSpellKeys.includes(key)) {
    failedSpellKeys.push(key);
  }
}

function getSpellCastingAbility(character, spell) {
  const className = String(character?.className || "").toLowerCase();
  const spellClasses = Array.isArray(spell?.classes) ? spell.classes.map((entry) => String(entry).toLowerCase()) : [];
  if (className.includes("priest") || (spellClasses.includes("priest") && !className.includes("wizard"))) {
    return "WIS";
  }
  return "INT";
}

function getSpellCastingModifier(character, spell) {
  return abilityScoreModifier(character?.stats?.[getSpellCastingAbility(character, spell)]) + castingBonus(character, getSpellCastingAbility(character,spell) === 'INT' ? 'wizard' : 'priest');
}

function getSpellCastingDc(spell) {
  return 10 + Math.max(0, Number(spell?.tier) || 0);
}

function characterHasSpellCastingAdvantage(character, spell) {
  const spellKey = getSpellKey(spell);
  if (!character || !spellKey) {
    return false;
  }
  if (spellKey === "magic missile") {
    return true;
  }
  const remappedMagicMissileAdvantage = getRemappedMagicMissileAdvantageSpell(character);
  if (remappedMagicMissileAdvantage && getSpellKey(remappedMagicMissileAdvantage) === spellKey) {
    const rawTalentText = JSON.stringify([
      character.levels || [],
      character.bonuses || [],
      character.raw?.levels || [],
      character.raw?.bonuses || []
    ]);
    if (/magic missile/i.test(rawTalentText) && /advantage|adv on cast|advoncastonespell/i.test(rawTalentText)) {
      return true;
    }
  }

  const advantageLines = buildTalentSpellLines(character).filter((line) => /gain advantage on casting/i.test(line));
  if (advantageLines.some((line) => normalizeSpellLookupKey(line).includes(spellKey))) {
    return true;
  }

  const rawTalentText = JSON.stringify([
    character.levels || [],
    character.bonuses || [],
    character.raw?.levels || [],
    character.raw?.bonuses || []
  ]);
  return /advantage|adv on cast/i.test(rawTalentText) && normalizeSpellLookupKey(rawTalentText).includes(spellKey);
}

function refreshOpenCharacterSheet(character) {
  if (SERVER_RUNTIME) return;
  updatePanels();
  if (!ui.characterSheetModal?.hidden && ui.characterSheetContent) {
    renderCharacterDetail(getCurrentCharacter(character), ui.characterSheetContent, { popout: true });
  }
}

function pendingSpellMessage(character) {
  if (character?.pendingSpell?.spell === 'light') return LIGHT_TARGET_PROMPT;
  if (character?.pendingSpell?.spell === 'floating disc') return 'Choose the critical Floating Disc effect first.';
  if (character?.pendingSpell?.spell === 'charm person') return character.pendingSpell.phase === 'critical' ? 'Choose the critical Charm Person effect first.' : 'Pick a humanoid to charm.';
  if (character?.pendingSpell?.spell === 'detect magic') return 'Choose the critical Detect Magic effect first.';
  if (hasReadyOffensiveSpell(character)) return 'Spell ready. Reposition, then select it again to release it this turn.';
  if (character?.pendingSpell?.spell === 'burning hands') return 'Choose the critical Burning Hands effect first.';
  return character?.pendingSpell?.spell === 'magic missile'
    ? character.pendingSpell.phase === 'critical' ? 'Choose the critical Magic Missile effect first.' : 'Pick a Magic Missile target or dismiss the remaining missiles.'
    : 'Choose the critical healing effect first.';
}

function canTargetMagicMissile(caster, monster) {
  return isCharacterAbleToAct(caster) && hasCharacterMapPosition(caster) && isLiveMonster(monster) &&
    monster.visible !== false &&
    canTargetAtRange(state, caster, monster, RANGE_LIMITS.far, {directAttack:true, requireLight:false});
}

function targetingTurnKey() {
  return isCombatActive() ? state.combat.round + ':' + getCurrentCombatEntry()?.id : 'exploration';
}

function currentTargetingOverlay() {
  const tierCaster = state?.characters.find(character => TIER_TWO_SPELLS.has(character.pendingSpell?.spell) &&
    ['targeting', 'placement'].includes(character.pendingSpell.phase) && canControlCharacter(character));
  if (tierCaster) {
    const pending = tierCaster.pendingSpell;
    return { kind: 'spell', characterId: tierCaster.id, spellKey: pending.spell,
      range: pending.spell === 'acid arrow' || ['silence','web'].includes(pending.spell) ? 12 : ['fixed object','levitate'].includes(pending.spell) ? 1 : pending.range || pending.radius || 6 };
  }
  if (sharedMonsterPresentation) return { kind: 'monster', monsterId: sharedMonsterPresentation.actor.id,
    actor: sharedMonsterPresentation.actor, range: sharedMonsterPresentation.range };
  if (monsterTurnRadius && monsterTurnRadius.until > Date.now()) {
    const monster = getMonsterById(monsterTurnRadius.id);
    if (monster) return { kind: 'monster', monsterId: monster.id, range: getMonsterAttackPreference(monster).preferNear ? 6 : 1 };
  }
  if (!targetingMode) {
    const thief = state.characters.find(character => character.pendingSteal?.phase === 'targeting' && character.pendingSteal.turnKey === targetingTurnKey() && canControlCharacter(character));
    if (thief) return { kind: 'steal', characterId: thief.id, range: 1 };
    const caster = state.characters.find(character => ['holy weapon','invisibility','charm person'].includes(character.pendingSpell?.spell) &&
      character.pendingSpell.phase === 'targeting' && canControlCharacter(character));
    if (caster) return {kind:'blessing', characterId:caster.id, range:caster.pendingSpell.radius};
    const active = getActiveCharacter(state);
    const attack = isCombatActive() && isCurrentCharacterTurn(active) && !state.combat.actionUsed && isCharacterAbleToAct(active) && getFirstCombatAttack(active);
    return attack && dismissedTurnRadius !== targetingTurnKey() ? { kind: 'weapon', characterId: active.id, range: attack.range.maxRange } : null;
  }
  const actor = state.characters.find(character => character.id === targetingMode.characterId);
  if (!canControlCharacter(actor) || !isCharacterAbleToAct(actor) || targetingMode.turnKey !== targetingTurnKey() ||
      (targetingMode.kind === 'weapon' && !isAttackEquipped(actor, targetingMode.attack))) {
    targetingMode = null;
    return null;
  }
  return { kind: targetingMode.kind, characterId: actor.id, spellKey:targetingMode.spellKey, range: targetingMode.kind === 'spell'
    ? targetingMode.spellKey === 'magic missile' ? RANGE_LIMITS.far : actor.pendingSpell?.radius || 1
    : targetingMode.kind === 'steal' ? 1 : getCombatAttackFromParsedAttack(targetingMode.attack).range.maxRange };
}

function beginWeaponTargeting(character, attack) {
  const actor = getCurrentCharacter(character);
  if (!canControlCharacter(actor) || !isCharacterAbleToAct(actor) || !isAttackEquipped(actor, attack)) return;
  if (actor.pendingSpell || (isCombatActive() && state.combat.actionUsed)) { setStatus(actor.pendingSpell ? pendingSpellMessage(actor) : 'This character has already acted this turn.'); return; }
  if (!activateCharacter(actor)) return;
  clickMoveGeneration += 1;
  targetingMode = { kind: 'weapon', characterId: actor.id, attack, turnKey: targetingTurnKey() };
  ui.characterSheetModal.hidden = true;
  ui.spellDetailModal.hidden = true;
  syncMagicMissileUi();
  setStatus('Pick a target for ' + attack.name + '.');
  render();
  updateMonsterHoverCursor();
}

function openOffensiveSpellTargeting(character, spellKey) {
  const caster = getCurrentCharacter(character);
  if (!canControlCharacter(caster) || !isCharacterAbleToAct(caster)) return;
  if (caster.pendingSpell && caster.pendingSpell.spell !== spellKey) { setStatus(pendingSpellMessage(caster)); return; }
  if (!activateCharacter(caster)) return;
  clickMoveGeneration += 1;
  targetingMode = { kind: 'spell', characterId: caster.id, spellKey, turnKey: targetingTurnKey() };
  ui.characterSheetModal.hidden = true;
  ui.spellDetailModal.hidden = true;
  syncMagicMissileUi();
  render();
}

function tryClickMovement(x, y) {
  if (!isCombatActive()) return false;
  const actor = getActiveCharacter(state);
  if (!canControlCharacter(actor) || !isCharacterAbleToAct(actor) || !pendingSpellAllowsCommand(actor, 'move')) return false;
  if (getCharacterAtTile(x, y) || state.entities.some(entity => Number(entity.x) === x && Number(entity.y) === y &&
      !entity.collected && !entity.defeated && entity.visible !== false && !(entity.type === 'trap' && !entity.revealed))) return false;
  const path = planClickMovement(state, actor, x, y, state.combat.movementRemaining);
  if (!path.length) { setStatus('That square is not reachable with the movement remaining.'); return true; }
  const generation = ++clickMoveGeneration;
  targetingMode = null;
  missileDisplay = null;
  syncMagicMissileUi();
  void (async () => {
    for (const step of path) {
      if (generation !== clickMoveGeneration || !isCurrentCharacterTurn(actor) || !canControlCharacter(actor)) break;
      const current = getCurrentCharacter(actor), before = Number(current.x) + ',' + Number(current.y);
      if (!isCharacterAbleToAct(current)) break;
      if (!sendSharedCommand('move', step, current)) applyLocalMovement([step.dx, step.dy]);
      const after = getCurrentCharacter(actor);
      if (before === Number(after.x) + ',' + Number(after.y)) break;
      await delay(70);
    }
  })();
  return true;
}

function syncMagicMissileUi() {
  if (SERVER_RUNTIME) return;
  const caster = state?.characters.find(character => OFFENSIVE_SPELLS.has(character.pendingSpell?.spell) && canControlCharacter(character));
  const pendingKey = caster ? caster.id + ':' + caster.pendingSpell.spell + ':' + (caster.pendingSpell.castNumber || targetingTurnKey()) + ':' + caster.pendingSpell.phase : null;
  if (caster && pendingKey !== lastPendingOffensiveSpell) {
    targetingMode = { kind: 'spell', characterId: caster.id, spellKey: caster.pendingSpell.spell, turnKey: targetingTurnKey() };
    ui.spellDetailModal.hidden = true;
    ui.characterSheetModal.hidden = true;
  }
  lastPendingOffensiveSpell = pendingKey;
  currentTargetingOverlay();
  const criticalModal = document.getElementById('missile-critical-modal');
  const wasHidden = criticalModal.hidden;
  criticalModal.hidden = caster?.pendingSpell.spell !== 'magic missile' || caster.pendingSpell.phase !== 'critical';
  criticalModal.dataset.characterId = caster?.id || '';
  for (const button of criticalModal.querySelectorAll('button')) button.disabled = sharedCommandPending > 0;
  if (!criticalModal.hidden && wasHidden) criticalModal.querySelector('button')?.focus();
  const burningModal = document.getElementById('burning-critical-modal');
  const burningWasHidden = burningModal.hidden;
  burningModal.hidden = caster?.pendingSpell.spell !== 'burning hands' || caster.pendingSpell.phase !== 'critical';
  burningModal.dataset.characterId = caster?.id || '';
  for (const button of burningModal.querySelectorAll('button')) button.disabled = sharedCommandPending > 0;
  if (!burningModal.hidden && burningWasHidden) burningModal.querySelector('button')?.focus();
  if (caster?.pendingSpell.spell === 'magic missile') {
    missileDisplay = { characterId: caster.id, castNumber: caster.pendingSpell.castNumber };
  }
  const displayCaster = state?.characters.find(character => character.id === targetingMode?.characterId && targetingMode?.kind === 'spell' && canControlCharacter(character));
  const pending = displayCaster?.pendingSpell?.spell === 'magic missile' ? displayCaster.pendingSpell : null;
  const completed = displayCaster?.lastMagicMissile && displayCaster.lastMagicMissile.castNumber === missileDisplay?.castNumber ? displayCaster.lastMagicMissile : null;
  const display = pending?.phase === 'targeting' ? pending : completed;
  const panel = document.getElementById('magic-missile-panel');
  panel.hidden = !displayCaster || displayCaster.pendingSpell?.phase === 'critical';
  if (panel.hidden) return;
  panel.dataset.characterId = displayCaster.id;
  const spell = findSpellRecord(targetingMode.spellKey);
  const ready = hasReadyOffensiveSpell(displayCaster);
  const burning = targetingMode.spellKey === 'burning hands';
  document.getElementById('magic-missile-title').textContent = spell?.name || (burning ? 'Burning Hands' : 'Magic Missile');
  document.getElementById('magic-missile-prompt').textContent = burning ? ready ? 'Burning Hands ready' : 'Close area: allies and enemies'
    : display?.remaining === 0 ? 'Missiles resolved' : ready ? display?.total === 2 ? 'Pick targets' : 'Pick target' : 'Far range: 12 squares';
  const dots = document.getElementById('magic-missile-dots');
  dots.replaceChildren();
  dots.hidden = burning;
  dots.setAttribute('aria-label', (display?.remaining ?? 1) + ' of ' + (display?.total ?? 1) + ' missiles remaining');
  for (let index = 0; !burning && index < (display?.total || 1); index += 1) {
    const dot = document.createElement('span');
    dot.className = 'magic-missile-dot' + (index < (display?.spent?.length || 0) ? ' is-spent' : '');
    dots.append(dot);
  }
  const last = display?.spent?.at(-1);
  const target = state.entities.find(entity => entity.id === last?.targetId);
  document.getElementById('magic-missile-result').textContent = last ? `${target?.name || 'Enemy'}: ${last.damage} damage` : '';
  const finish = document.getElementById('magic-missile-finish');
  finish.textContent = ready ? 'Back to Movement' : 'Close';
  finish.disabled = sharedCommandPending > 0;
  const castButton = document.getElementById('offensive-spell-cast');
  castButton.hidden = ready || display?.phase === 'complete';
  castButton.disabled = sharedCommandPending > 0 || isCharacterSpellFailed(displayCaster, targetingMode.spellKey) ||
    (isCombatActive() && state.combat.actionUsed);
  const release = document.getElementById('offensive-spell-release');
  release.hidden = !burning || !ready;
  release.disabled = sharedCommandPending > 0;
  const discard = document.getElementById('offensive-spell-discard');
  discard.hidden = !ready;
  discard.disabled = sharedCommandPending > 0;
}

function finishLightSpell(character, selection) {
  if (sendSharedCommand('resolve_spell', { target_id: selection.targetId, x: selection.x, y: selection.y }, character)) return;
  try {
    const result = resolveLight(state, getCurrentCharacter(character), selection);
    syncAllCharacterEquipmentDerivedStats(); recomputeVisibility(state); markRunDirty();
    setStatus(result.message); updatePanels(); render(); scheduleAutoEndTurnIfNeeded();
  } catch (error) { if (SERVER_RUNTIME) throw error; setStatus(error.message); }
}

function resolveMagicMissile(character, { choice, targetId, x, y, blind = false, dismiss = false } = {}) {
  if (sendSharedCommand('resolve_spell', { choice, target_id: targetId, x, y, blind, dismiss }, character)) return;
  const caster = getCurrentCharacter(character);
  try {
    let outcome;
    if (dismiss) {
      if (!isCombatActive() && caster.pendingSpell?.spent.length) caster.openingSpellActionSpent = true;
      outcome = dismissMagicMissiles(caster);
    }
    else if (choice) outcome = chooseMagicMissile(caster, choice);
    else {
      let monster = blind ? null : getMonsterById(targetId);
      outcome = fireMagicMissile(caster, blind ? { x, y, blind: true } : monster, { state, canTarget: target => canTargetMagicMissile(caster, target) });
      monster = monster || outcome.guessedMonster;
      if (blind && monster) markMonsterCorrectlyGuessed(monster);
      const surprisedMimic=concealedMimic(monster);
      if(surprisedMimic)monster.disguiseRevealed=true;
      const concealed = isStealthed(caster) || caster.castFromConcealment;
      revealAfterOffense(caster);state.lastDamageSourceId=caster.id;
      if (outcome.defeated) outcome.message += ` ${defeatMonster(state, monster).message}`;
      const alerting = monster ? getAlertingMonstersFromAttack(monster).filter(target => !outcome.defeated || target.id !== monster.id) : [];
      for (const target of alerting) { target.attitude = 'combat'; target.attitudeChecked = true; target.hostile = true; }
      if (alerting.length && !isCombatActive()) {
        if (!caster.pendingSpell) caster.openingSpellActionSpent = true;
        beginCombat(`Combat begins after ${caster.name}'s Magic Missile.`,{initiator:concealed||surprisedMimic?caster:null,
          forcedSurprisedIds:surprisedMimic?[monster.id]:[],extraMonsterIds:alerting.map(target=>target.id)});
        // Casting outside combat is still the caster's action for the opening round.
        if (isCurrentCharacterTurn(caster)) state.combat.actionUsed = true;
      } else if (isCombatActive()) {
        detectAdditionalCombatMonsters();
        checkCombatEnd();
      }
      pushDiceHistory('Magic Missile', outcome.message, caster.id);
      pushCombatLog(outcome.message);
    }
    markRunDirty();
    markUserActivity();
    setStatus(outcome.message);
    if (dismiss) { missileDisplay = null; if (!SERVER_RUNTIME) targetingMode = null; }
    if (!caster.pendingSpell) processMonsterVisibilityChange();
    if (!isCombatActive()) caster.openingSpellActionSpent = false;
    syncMagicMissileUi();
    refreshOpenCharacterSheet(caster);
    scheduleAutoEndTurnIfNeeded();
    render();
  } catch (error) {
    if (SERVER_RUNTIME) throw error;
    setStatus(error.message);
  }
}

function resolveBurningHands(character, { choice, dismiss = false } = {}) {
  if (sendSharedCommand('resolve_spell', { choice, dismiss }, character)) return;
  const caster = getCurrentCharacter(character);
  try {
    let outcome;
    if (choice) outcome = chooseBurningHands(caster, choice);
    else if (dismiss) {
      if (caster.pendingSpell?.spell !== 'burning hands') throw new Error('Burning Hands is not ready.');
      caster.pendingSpell = null;
      outcome = { message: 'Unused Burning Hands dissipates. The casting action remains spent.' };
      if (!SERVER_RUNTIME) targetingMode = null;
    } else {
      const concealed = isStealthed(caster) || caster.castFromConcealment;
      revealAfterOffense(caster);state.lastDamageSourceId=caster.id;
      const surprisedMimicIds=state.entities.filter(concealedMimic).map(monster=>monster.id);
      outcome = releaseBurningHands(state, caster);
      for (const hit of outcome.hits) if (hit.type === 'character') {
        const target = state.characters.find(member => member.id === hit.id);
        if (target?.companion?.kind === 'charmed') endCharacterCharm(target, true);
      }
      for (const hit of outcome.hits) if (hit.type === 'monster') {
        const monster = getMonsterById(hit.id);
        if(monster&&surprisedMimicIds.includes(monster.id))monster.disguiseRevealed=true;
        if (hit.defeated) defeatMonster(state, monster);
        else if (monster) { monster.attitude = 'combat'; monster.hostile = true; monster.attitudeChecked = true; }
      }
      if (!isCombatActive() && outcome.hits.some(hit => hit.type === 'monster')) {
        caster.openingSpellActionSpent = true;
        const forced=outcome.hits.filter(hit=>surprisedMimicIds.includes(hit.id)).map(hit=>hit.id);
        beginCombat('Combat begins after Burning Hands.',{initiator:concealed||forced.length?caster:null,
          forcedSurprisedIds:forced,extraMonsterIds:outcome.hits.filter(hit=>hit.type==='monster'&&!hit.defeated).map(hit=>hit.id)});
        if (!isCombatActive()) caster.openingSpellActionSpent = false;
      } else if (isCombatActive()) { detectAdditionalCombatMonsters(); checkCombatEnd(); }
      for (const member of state.characters) { clearMagicLightIfIncapacitated(member); syncCharacterDyingRaw(member); }
      pushDiceHistory('Burning Hands', outcome.message, caster.id);
      pushCombatLog(outcome.message);
      if (!SERVER_RUNTIME) { targetingMode = null; missileDisplay = null; }
    }
    syncAllCharacterEquipmentDerivedStats();
    syncPlayerLightFromActiveCharacter();
    recomputeVisibility(state);
    markRunDirty(); markUserActivity();
    setStatus(outcome.message);
    refreshOpenCharacterSheet(caster);
    syncMagicMissileUi();
    scheduleAutoEndTurnIfNeeded();
    render();
  } catch (error) {
    if (SERVER_RUNTIME) throw error;
    setStatus(error.message);
  }
}

function recordWizardTurn(character) {
  if (isRaving(character)) return false;
  const message = processWizardTurn(character, getCharacterKnownSpellNames(character), { state,
    ...higherMishapContext(character), castingMode: tier => wizardCastingMode(character, tier) });
  if (message) { pushDiceHistory('Spell worm', message, character.id); pushCombatLog(message); setStatus(message); }
  return Boolean(message);
}

function summonMishapMonster(origin, { name = null, minimumLevel = 0, rounds = 0 } = {}) {
  const sources = (shadowdarkContent?.monsters || []).filter(monster => name ? monster.name.toLowerCase() === name.toLowerCase() : Number(monster.level) >= minimumLevel);
  const occupied = new Set([...state.characters.filter(character => !character.dead && !character.slain), ...getLiveMonsters()].map(creature => creature.x + ',' + creature.y));
  const candidates = state.tiles.filter(tile => tile.type === 'floor' && !occupied.has(tile.x + ',' + tile.y) &&
    Math.hypot(tile.x - origin.x, tile.y - origin.y) <= 6 && canMoveBetweenTiles(state, tile.x, tile.y, tile.x, tile.y).ok);
  if (!sources.length || !candidates.length) return 'No free nearby floor can hold the summoned monster.';
  const source = sources[Math.floor(Math.random() * sources.length)], tile = candidates[Math.floor(Math.random() * candidates.length)];
  const monster = { ...structuredClone(source), id: `arcane-monster-${Date.now()}-${state.entities.length}`, type: 'monster',
    x: tile.x, y: tile.y, roomId: tile.roomId, maxHp: Number(source.hp), hp: Number(source.hp), visible: true,
    hostile: true, attitude: 'combat', attitudeChecked: true, defeated: false, arcaneSummonRounds: rounds || null };
  state.entities.push(monster);
  if (isCombatActive()) addMonstersToCombat([monster], 'An arcane mishap summons a foe.');
  else beginCombat('An arcane mishap summons a foe.', { extraMonsterIds: [monster.id] });
  return `${monster.name} emerges${rounds ? ` for ${rounds} rounds` : ''}.`;
}

function resolveForcedMishapSpell(caster, name, targets) {
  const key = getSpellKey(name), messages = [];
  for (const target of targets) {
    if (key === 'magic missile') {
      const damage = rollDamageExpression('1d4').total;
      if (state.characters.includes(target)) setCharacterHp(target, target.hp - damage, { sourceId: caster.id });
      else { target.hp = Math.max(0, target.hp - damage); wakeCreature(target, state); if (target.hp <= 0) defeatMonster(state, target); }
      messages.push(`${name} strikes ${target.name} for ${damage} damage.`);
    } else if (key === 'burning hands') messages.push(applyBurningHands(state, caster, { center: target, includeCaster: true }).message);
    else if (key === 'mage armor') {
      target.wizardEffects = (target.wizardEffects || []).filter(effect => effect.type !== 'mage-armor');
      target.wizardEffects.push({ type: 'mage-armor', armorClass: 14, rounds: 10 }); messages.push(`${target.name} gains Mage Armor for ten rounds.`);
    } else if (key === 'invisibility') {
      target.invisibility = { rounds: 10, source: 'spell', breakOnOffense: true }; messages.push(`${target.name} becomes invisible.`);
    } else if (key === 'light' && state.characters.includes(target)) {
      setCharacterLight(target, 'light-spell'); messages.push(`${target.name} carries magical light.`);
    } else return null;
  }
  return messages.join(' ');
}

function higherMishapContext(caster, spell = null, targetId = null) {
  return { tier: Number(spell?.tier) || 1, knownSpells: getCharacterKnownSpellNames(caster),
    turnKey: isCombatActive() ? `${state.combat.round}:${state.combat.turnIndex}:${caster.id}` : `crawl:${state.arcaneTurnSequence || 0}:${caster.id}`,
    spellTier: name => Number(findSpellRecord(name)?.tier) || 1,
    canSee: (viewer, target) => viewer.id === target.id || isTileVisible(state, target.x, target.y, target) && creatureSight(viewer, target),
    lineOfEffect: creatureSight,
    targets: targetId ? [...state.characters, ...state.entities].filter(target => target.id === targetId) : [],
    resolveMisfire: target => ({ targetId: target.id, detail: queueForcedSpell(state, caster, spell?.name || 'Unknown spell', [target], { resolveForcedSpell: resolveForcedMishapSpell }) }),
    resolveForcedSpell: resolveForcedMishapSpell, summon: summonMishapMonster,
    queueFall: (target, event) => { if (!canCastFeatherFall(target) || !isCharacterAbleToAct(target)) return false; queueFallingDamage(target, event); return true; }
  };
}

function performMishapAction(character, command) {
  if (sendSharedCommand('mishap_action', command, character)) return;
  const caster = getCurrentCharacter(character);
  if (!caster || !ownsCharacter(caster)) throw new Error('This character is not yours.');
  let message;
  if (command.action === 'sacrifice') message = resolveOrdBalance(caster, { kind: command.kind, name: command.name, index: command.gear_index }, name => Number(findSpellRecord(name)?.tier) || 1);
  else {
    if (!isCharacterAbleToAct(caster) || isCombatActive() && !isCurrentCharacterTurn(caster)) throw new Error('This character cannot act now.');
    const gate = state.entities.find(entity => entity.id === command.entity_id && entity.subtype === 'arcane-gate' && !entity.closed && entity.casterId === caster.id);
    if (command.action !== 'climb' && command.action !== 'close-gate' || command.action === 'climb' && !pitAtBottom(state, caster) || command.action === 'close-gate' && !gate) throw new Error('That mishap action is no longer available.');
    if (command.action === 'climb' && !safePitRim(state, pitAtBottom(state, caster), caster, pitActionOptions())) throw new Error('There is no free, safe square beside this pit.');
    if (!consumeCharacterCombatAction(caster)) { if (SERVER_RUNTIME) throw new Error('Action unavailable.'); return; }
    const stat = command.action === 'climb' ? 'STR' : 'INT', dc = command.action === 'climb' ? 15 : 18;
    const climb = command.action === 'climb' ? climbFromPit(state, caster, pitActionOptions()) : null;
    const result = climb?.check || rollCheck(abilityScoreModifier(caster.stats?.[stat]));
    if (result.total >= dc) {
      if (gate) gate.closed = true;
      else {
        const spent = caster.conditions.sinkholeMovementSpent || 0;
        delete caster.conditions.sinkhole; delete caster.conditions.sinkholeMovementSpent; delete caster.conditions.prone;
        if (isCombatActive()) { state.combat.movementBudget = characterMovementBudget(caster); state.combat.movementRemaining = Math.max(0, state.combat.movementBudget - spent); }
      }
    }
    message = `${caster.name}: ${command.action === 'climb' ? 'climb out' : 'close Gate'} ${result.total} vs DC ${dc}: ${result.total >= dc ? 'success' : 'failed'}.`;
    pushDiceHistory('Mishap recovery', message, caster.id, rollTextSegments(message, result));
  }
  caster.raw.gear = structuredClone(caster.gear); markRunDirty(); syncAllCharacterEquipmentDerivedStats(); recomputeVisibility(state);
  setStatus(message); updatePanels(); render(); scheduleAutoEndTurnIfNeeded();
}

function pitActionOptions() {
  return { check: rollCheck, canStep: (x, y, nx, ny, creature) => canMoveBetweenTiles(state, x, y, nx, ny, { ignorePits: true, creature, routeId: creature && routeOf(state, creature) }).ok,
    canSee: monster => isMonsterCurrentlyVisible(state, monster) };
}

function updateMiniPitActions(container, character) {
  const options = pitActionOptions(), entries = [], seen = new Set();
  for (const { target } of ropeRescues(state, character, options)) entries.push([`Rescue ${target.name}`, { action: 'rescue', target_id: target.id }]);
  for (const pit of ropeDescents(state, character, options)) entries.push(['Climb Down', { action: 'descend', pit_id: pit.id }]);
  for (const { monster, pit } of pushTargets(state, character, options)) if (!seen.has(monster.id)) {
    seen.add(monster.id); entries.push([`Push ${displayMonsterName(monster)}`, { action: 'push', target_id: monster.id, pit_id: pit.id }]);
  }
  if (pitAtBottom(state, character)) entries.push(['Climb Out', { action: 'climb' }]);
  if (grapplingEscapeOption(state, character, options)) entries.push(['Grapple Out', { action: 'grapple' }]);
  for (const bridge of ropeBridgeOptions(state, character, options)) entries.push([`Bridge Pit (${bridge.ropeFeet}' rope)`, { action: 'bridge', pit_id: bridge.pitId,
    direction: { dx: Math.sign(bridge.destination.x - character.x), dy: Math.sign(bridge.destination.y - character.y) } }]);
  for (const target of tieTargets(state, character, options)) entries.push([`Tie ${target.name}`, { action: 'tie', target_id: target.id }]);
  if (isTied(character)) entries.push(['Escape (DEX)', { action: 'escape' }], ['Break Rope (STR)', { action: 'break' }]);
  if (isRestrainedByWeb(state, character)) entries.push(['Escape Web', { action: 'escape_web' }]);
  const disabled = !canControlCharacter(character) || !isCharacterAbleToAct(character) || isCombatActive() && (!isCurrentCharacterTurn(character) || state.combat.actionUsed);
  const signature = JSON.stringify([entries, disabled]);
  if (container.dataset.signature === signature) return;
  container.dataset.signature = signature; container.hidden = !entries.length; container.replaceChildren();
  for (const [text, command] of entries) {
    const button = document.createElement('button'); button.type = 'button'; button.textContent = text; button.disabled = disabled;
    button.onclick = event => { event.stopPropagation(); try {
      const current = getCurrentCharacter(character);
      if (command.action === 'descend') showPitDescentOffer(current, state.entities.find(pit => pit.id === command.pit_id));
      else if (command.action === 'climb') performMishapAction(current, command);
      else performPitAction(current, command);
    } catch (error) { setStatus(error.message); } };
    container.append(button);
  }
}

function performPitAction(character, command) {
  if (sendSharedCommand('pit_action', command, character)) return;
  const helper = getCurrentCharacter(character), options = pitActionOptions();
  if (!helper || !ownsCharacter(helper)) throw new Error('This character is not yours.');
  if (!isCharacterAbleToAct(helper) || isIncorporeal(helper) || isFloatingDisc(helper) || helper.conditions?.paralyzed ||
      state.characters.some(member => member.pendingFall) || isCombatActive() && !isCurrentCharacterTurn(helper)) throw new Error('This character cannot act now.');
  if (command.action === 'escape_web') {
    if (!consumeCharacterCombatAction(helper)) throw new Error('Action unavailable.');
    const result = escapeWeb(state, helper); setStatus(result.message); pushDiceHistory('Escape Web', result.message, helper.id);
    markRunDirty(); updatePanels(); render(); scheduleAutoEndTurnIfNeeded(); return;
  }
  if (['grapple', 'bridge', 'tie', 'escape', 'break'].includes(command.action)) {
    let result, message;
    if (command.action === 'grapple') {
      result = escapePitWithGrapplingHook(state, helper, options); message = `${helper.name} climbs out with a grappling hook.`;
    } else if (command.action === 'bridge') {
      result = buildRopeBridge(state, helper, command.pit_id, { ...options, direction: command.direction });
      message = `${helper.name} bridges the pit with ${result.bridge.ropeFeet} feet of rope.`;
    } else if (command.action === 'tie') {
      result = tieWithRope(state, helper, command.target_id, options); message = `${helper.name} ties the creature. Escape DC ${result.dc}.`;
    } else {
      result = escapeRope(state, helper, command.action, options);
      message = `${helper.name}: ${result.check.total} vs DC ${result.dc}; ${result.escaped ? 'freed from the rope.' : 'still tied.'}`;
    }
    syncPlayerToActiveCharacter(); syncAllCharacterEquipmentDerivedStats(); recomputeVisibility(state); markRunDirty();
    pushDiceHistory('Rope', message, helper.id); setStatus(message); updatePanels(); render(); scheduleAutoEndTurnIfNeeded(); return;
  }
  if (isTied(helper)) throw new Error('Escape or break the rope before acting.');
  const valid = command.action === 'rescue' ? ropeRescues(state, helper, options).some(item => item.target.id === command.target_id) :
    command.action === 'descend' ? ropeDescents(state, helper, options).some(pit => pit.id === command.pit_id) :
    command.action === 'push' && pushTargets(state, helper, options).some(item => item.monster.id === command.target_id && item.pit.id === command.pit_id);
  if (!valid) throw new Error('That pit action is no longer available.');
  if (!consumeCharacterCombatAction(helper)) { if (SERVER_RUNTIME) throw new Error('Action unavailable.'); return; }
  const result = command.action === 'rescue' ? rescueWithRope(state, helper, command.target_id, options) :
    command.action === 'descend' ? descendWithRope(state, helper, command.pit_id, options) : pushIntoPit(state, helper, command.target_id, command.pit_id, options);
  if (result.monster) {
    revealAfterOffense(helper);
    result.monster.hostile = true; result.monster.attitude = 'combat'; result.monster.attitudeChecked = true;
    if (result.monster.hp <= 0) defeatMonster(state, result.monster);
    else if (!isCombatActive()) { helper.openingSpellActionSpent = true; beginCombat('Combat begins.', { initiator: helper, extraMonsterIds: [result.monster.id] }); }
  }
  pushDiceHistory(command.action === 'rescue' ? 'Rope rescue' : 'Push', result.message, helper.id,
    result.check ? rollTextSegments(result.message, result.check) : undefined);
  syncAllCharacterEquipmentDerivedStats(); recomputeVisibility(state); markRunDirty(); checkCombatEnd();
  setStatus(result.message); updatePanels(); render(); scheduleAutoEndTurnIfNeeded();
}

function syncPitRescueUi() {
  if (SERVER_RUNTIME) return;
  let modal = document.getElementById('pit-rescue-modal');
  if (!modal) {
    modal = document.createElement('div'); modal.id = 'pit-rescue-modal'; modal.className = 'modal-backdrop'; modal.hidden = true;
    const card = document.createElement('section'); card.className = 'modal-card'; card.setAttribute('role', 'dialog'); card.setAttribute('aria-modal', 'true'); card.setAttribute('aria-label', 'Rope rescue');
    const message = document.createElement('p'), yes = document.createElement('button'), no = document.createElement('button');
    yes.type = no.type = 'button'; yes.textContent = 'Yes'; no.textContent = 'No';
    yes.onclick = () => { try { performPitAction(state.characters.find(member => member.id === modal.dataset.helperId), { action: 'rescue', target_id: modal.dataset.targetId }); } catch (error) { setStatus(error.message); } };
    no.onclick = () => { modal.dataset.dismissed = modal.dataset.offer; modal.hidden = true; };
    card.append(message, yes, no); modal.append(card); document.body.append(modal);
  }
  const selected = getActiveCharacter(state);
  const available = !restInProgress(state) && !state.encounterPrompt && !state.characters.some(member => member.pendingFall);
  const helpers = [selected, ...state.characters.filter(member => member.id !== selected?.id)].filter(helper => helper &&
    ownsCharacter(helper) && isCharacterAbleToAct(helper) && !helper.pendingSpell &&
    (!isCombatActive() || isCurrentCharacterTurn(helper) && !state.combat.actionUsed));
  const choice = available && helpers.map(helper => ({ helper, rescue: ropeRescues(state, helper, pitActionOptions())[0] })).find(option => option.rescue);
  const helper = choice?.helper, rescue = choice?.rescue;
  const offer = rescue ? `${helper.id}:${rescue.target.id}:${rescue.pit.id}:${state.combat?.round || 0}` : '';
  modal.hidden = !rescue || modal.dataset.dismissed === offer;
  if (!rescue) return;
  modal.dataset.helperId = helper.id; modal.dataset.targetId = rescue.target.id; modal.dataset.offer = offer;
  modal.querySelector('p').textContent = `Use rope to help ${rescue.target.name} climb out of the pit?`;
  for (const button of modal.querySelectorAll('button')) button.disabled = sharedCommandPending > 0;
}

function showPitDescentOffer(character, pit) {
  let modal = document.getElementById('pit-descent-modal');
  if (!modal) {
    modal = document.createElement('div'); modal.id = 'pit-descent-modal'; modal.className = 'modal-backdrop'; modal.hidden = true;
    const card = document.createElement('section'); card.className = 'modal-card'; card.setAttribute('role', 'dialog');
    card.setAttribute('aria-modal', 'true'); card.setAttribute('aria-label', 'Climb down');
    const text = document.createElement('p'); text.textContent = 'Climb down?';
    const yes = document.createElement('button'), no = document.createElement('button');
    yes.type = no.type = 'button'; yes.textContent = 'Yes'; no.textContent = 'No';
    yes.onclick = () => { modal.hidden = true; modal.dataset.dismissed = modal.dataset.offer;
      try { performPitAction(state.characters.find(member => member.id === modal.dataset.characterId), { action: 'descend', pit_id: modal.dataset.pitId }); }
      catch (error) { setStatus(error.message); } };
    no.onclick = () => { modal.dataset.dismissed = modal.dataset.offer; modal.hidden = true; };
    card.append(text, yes, no); modal.append(card); document.body.append(modal);
  }
  modal.dataset.characterId = character.id; modal.dataset.pitId = pit.id;
  modal.dataset.offer = `${character.id}:${pit.id}:${character.x},${character.y}:${state.combat?.round || 0}`;
  modal.hidden = false;
  for (const button of modal.querySelectorAll('button')) button.disabled = sharedCommandPending > 0;
}

function syncPitDescentUi() {
  if (SERVER_RUNTIME) return;
  const character = getActiveCharacter(state), modal = document.getElementById('pit-descent-modal');
  const enabled = character && canControlCharacter(character) && isCharacterAbleToAct(character) && !character.pendingSpell &&
    !restInProgress(state) && !state.encounterPrompt && !state.characters.some(member => member.pendingFall) &&
    (!isCombatActive() || isCurrentCharacterTurn(character) && !state.combat.actionUsed) && document.getElementById('pit-rescue-modal')?.hidden !== false;
  const pit = enabled && ropeDescents(state, character, pitActionOptions()).find(pit =>
    character.lastPitAscent?.pitId !== pit.id || character.lastPitAscent.x !== character.x || character.lastPitAscent.y !== character.y);
  if (!pit) { if (modal) modal.hidden = true; return; }
  const offer = `${character.id}:${pit.id}:${character.x},${character.y}:${state.combat?.round || 0}`;
  if (modal?.dataset.dismissed !== offer) showPitDescentOffer(character, pit);
}

function syncMishapUi() {
  if (SERVER_RUNTIME) return;
  let modal = document.getElementById('ord-balance-modal');
  if (!modal) {
    modal = document.createElement('div'); modal.id = 'ord-balance-modal'; modal.className = 'modal-backdrop'; modal.hidden = true;
    const card = document.createElement('section'); card.className = 'modal-card'; card.setAttribute('role', 'dialog'); card.setAttribute('aria-modal', 'true');
    card.setAttribute('aria-label', "Ord's Balance"); modal.append(card); document.body.append(modal);
  }
  const caster = state.characters.find(character => ownsCharacter(character) && character.wizardEffects?.some(effect => effect.type === 'ord-balance' && effect.pending));
  modal.hidden = !caster;
  if (state.characters.some(character => character.pendingFall)) { modal.hidden = true; return; }
  if (!caster) return;
  const options = ordBalanceOptions(caster, name => Number(findSpellRecord(name)?.tier) || 1), key = JSON.stringify([caster.id, options, sharedCommandPending]);
  if (!options.length && modal.dataset.dismissed === key) { modal.hidden = true; return; }
  if (modal.dataset.key === key) return; modal.dataset.key = key;
  const card = modal.firstElementChild; card.replaceChildren();
  const title = document.createElement('h2'); title.textContent = `${caster.name}: Ord's Balance`;
  const description = document.createElement('p'); description.textContent = 'Permanently sacrifice one magic item or one listed spell.'; card.append(title, description);
  for (const option of options) {
    const row = document.createElement('div'); row.className = 'advancement-spell';
    const label = document.createElement('span'); label.textContent = option.name;
    const button = document.createElement('button'); button.type = 'button'; button.textContent = 'Sacrifice'; button.disabled = sharedCommandPending > 0;
    button.onclick = () => { try { performMishapAction(caster, { action: 'sacrifice', kind: option.kind, name: option.name, gear_index: option.index }); } catch (error) { setStatus(error.message); } };
    row.append(label, button); card.append(row);
  }
  if (!options.length) { description.textContent = 'No item or known spell can be sacrificed yet. This debt remains until a spell is learned or a magic item is obtained.'; const close = document.createElement('button'); close.textContent = 'Close'; close.onclick = () => { modal.dataset.dismissed = key; modal.hidden = true; }; card.append(close); }
}

function tierTwoOptions() {
  return {
    monsterAttacks: getMonsterAttackOptions,
    onDefeat: (...args) => {
      const target = args[0] === state ? args[1] : args[0];
      if (target?.type === 'monster' && !target.defeated) defeatMonster(state, target);
    },
    grantLuck: (_state, caster) => grantLuckToken(state, caster.id),
    onLuck: caster => grantLuckToken(state, caster.id),
    criticalChoices: TIER_TWO_CHOICES,
    onCriticalChoice: (_state, caster, focus, choice) => {
      if (focus.spell === 'silence' && choice === 'area') {
        const zone = state.areaSpells?.find(area => area.id === focus.areaId);
        if (zone) { zone.x -= 3; zone.y -= 3; zone.width = zone.height = 12; }
      }
    },
    wanderingCheck: ({ origin }) => {
      const result = maybeSpawnWanderingMonster(state, monsterTable, { ignoreDarkness: true, allowUnlit: true, origin, forceEncounter: true });
      if (result.spawned) { result.entity.hostile = true; result.entity.attitude = 'combat'; result.entity.attitudeChecked = true; addMonstersToCombat([result.entity], 'Knock attracts a wandering monster.'); }
    }
  };
}

function finishTierTwoSpell(character, selection = {}) {
  if (!character) return;
  if (!SERVER_RUNTIME && character.pendingSpell?.spell === 'misty step' && character.pendingSpell.phase === 'targeting' && !selection.dismiss && !selection.choice && !selection.confirmed) {
    const destination = validateMistyStepDestination(state, character, selection);
    if (destination.requiresConfirmation) {
      if (!window.confirm(destination.prompt)) return;
      selection = { ...selection, confirmed: true };
    }
  }
  if (sendSharedCommand('resolve_spell', { choice: selection.choice, option: selection.option, target_id: selection.targetId,
    x: selection.x, y: selection.y, confirmed: selection.confirmed, gear_index: selection.gearIndex, dismiss: selection.dismiss }, character)) return;
  const outcome = resolveTierTwoSpell(state, character, selection, tierTwoOptions());
  rememberSpellDialogs(outcome);
  if (outcome.requiresConfirmation && outcome.prompt && !SERVER_RUNTIME) {
    if (window.confirm(outcome.prompt)) finishTierTwoSpell(character, { ...selection, confirmed: true });
    return;
  }
  syncTransformationEffects(state); syncAreaSpellConditions(state); cleanupWizardTierTwoFocus(state);
  for (const monster of state.entities.filter(entity => entity.type === 'monster' && !entity.defeated && Number(entity.hp) <= 0)) defeatMonster(state, monster);
  syncPlayerToActiveCharacter(); recomputeVisibility(state); prepareEncounterState(); checkCombatEnd();
  markRunDirty(); markUserActivity(); setStatus(outcome.message || 'Spell resolved.');
  pushDiceHistory('Spell', outcome.message || 'Spell resolved.', character.id);
  render(); updatePanels(); scheduleAutoEndTurnIfNeeded();
}

function getTierTwoUi() {
  if (SERVER_RUNTIME) return null;
  return tierTwoUi ||= createTierTwoUi({
    getPresentation: () => {
      const caster = state?.characters.find(member => TIER_TWO_SPELLS.has(member.pendingSpell?.spell) && canControlCharacter(member));
      const view = tierTwoPresentation(state, caster);
      if (view && caster.pendingSpell.spell === 'fixed object' && caster.pendingSpell.phase !== 'critical')
        view.gear = (caster.gear || []).map((item, gearIndex) => ({ label: item.name, gearIndex }));
      if (view) { ui.spellDetailModal.hidden = true; ui.characterSheetModal.hidden = true; ui.spellcastingModal.hidden = true; }
      return view;
    },
    resolve: selection => finishTierTwoSpell(state.characters.find(member => TIER_TWO_SPELLS.has(member.pendingSpell?.spell) && canControlCharacter(member)), selection),
    preview: selection => {
      const caster = state?.characters.find(member => TIER_TWO_SPELLS.has(member.pendingSpell?.spell) && canControlCharacter(member));
      try { areaPreview = selection && caster ? { ...areaSpellPlacement(state, caster, selection, selection.size), color: caster.colorValue, spell: caster.pendingSpell.spell } : null; }
      catch (error) { areaPreview = null; setStatus(error.message); }
      render();
    }, mapHost: ui.mapHost, status: setStatus
  });
}

function rememberSpellDialogs(outcome) {
  if (!outcome.dialogs?.length) return;
  state.spellDialogMessages ||= [];
  for (const dialog of outcome.dialogs) state.spellDialogMessages.push({ id: crypto.randomUUID(), text: dialog.text });
  state.spellDialogMessages = state.spellDialogMessages.slice(-8);
}

function recordFocusCheck(character, reason) {
  if (character.focusSpell && silenceBlocksAction(state, character, { spellcasting: true })) {
    character.focusSpell = null; cleanupWizardTierTwoFocus(state); syncTransformationEffects(state); syncAreaSpellConditions(state);
    return { message: `${character.name} loses Focus inside Silence.` };
  }
  const spell = character.focusSpell?.spell;
  let luck = null;
  const checkRoll = (modifier, options) => {
    const check = rollCheck(modifier, options);
    if (!isLuckResolution(state)) {
      luck = beginLuckEvent(state, { kind: 'cast', actor: luckActorRef(character), roll: check,
        dc: 10 + Number(findSpellRecord(spell)?.tier || 1), context: { spell, focus: true, reason },
        scope: [...state.characters, ...state.entities.filter(entity => entity.type === 'monster')].map(luckActorRef) });
      for (const actor of [...state.characters, ...state.entities.filter(entity => entity.type === 'monster')]) captureLuckActor(luck, actor);
    }
    return check;
  };
  const focusCheck = character.focusSpell?.spell === 'levitate' ? maintainLevitationFocus : isTierTwoFocus(character.focusSpell) ? maintainTierTwoFocus : character.focusSpell?.spell === 'detect magic' ? maintainDetectMagic : maintainFocus;
  const outcome = focusCheck(state, character, { reason,
    ...tierTwoOptions(), checkRoll, rollCheck: checkRoll,
    disadvantage: protectionDisadvantage(state, character),
    advantage: characterHasSpellCastingAdvantage(character, findSpellRecord(character.focusSpell?.spell)) });
  if (outcome) {
    rememberSpellDialogs(outcome);
    pushDiceHistory('Focus', outcome.message, character.id); pushCombatLog(outcome.message); setStatus(outcome.message);
    markRunDirty();
  }
  if (luck) finishLuckEvent(state, luck, { succeeded: outcome?.succeeded === true });
  return outcome;
}

setCharacterDamageListener((character,damage,sourceId) => {
  if (state?.characters.includes(character)) recordCompanionDamage(character,damage);
  if (character.companion?.charm && sourceId !== character.id && state?.characters.some(member => member.id === sourceId)) {
    character.companion.charm.brokenByParty = true;
  }
  if (state?.characters.includes(character) && character.focusSpell) recordFocusCheck(character, 'damage');
  if (state?.characters.includes(character) && Number(character.hp) <= 0) progressFloatingDiscTime(0);
});

function progressWizardEffects(milliseconds, { rounds = null, crawlingTurns = false } = {}) {
  const discsChanged = progressFloatingDiscTime(milliseconds);
  const hasItems = state.characters.some(character => character.potionEffects?.length || character.companion?.charm || character.transformationEffects?.length) || state.entities.some(entity => entity.charm || entity.fixedObject) || state.areaSpells?.length;
  if (hasItems) advanceCharmTime(milliseconds);
  const hasFaith = state.entities.some(portalHeld) || state.characters.some(character => character.invisibility || character.faithEffects?.length || character.focusSpell || character.gear?.some(item => item.holyWeapon)) ||
    state.entities.some(entity => entity.invisibility || entity.moraleFlight || entity.turnedUndead || entity.gearItem?.holyWeapon);
  const phenomena = state.entities.some(entity => entity.subtype === 'arcane-shred' || entity.subtype === 'arcane-gate' && !entity.closed || entity.arcaneSummonRounds > 0);
  if (!hasItems && !hasFaith && !phenomena && !state.characters.some(character => character.wizardEffects?.length || Object.keys(character.spellLocks || {}).length)) return discsChanged;
  const lightingMayChange = phenomena || state.characters.some(character => hasWizardEffect(character, 'light-suppression'));
  const armoredIds = new Set(state.characters.filter(mageArmorEffect).map(character => character.id));
  state.arcaneTime ||= { crawlRemainderMs: 0, elapsedMs: 0 };
  state.arcaneTime.elapsedMs += milliseconds;
  if (rounds == null) {
    state.arcaneTime.crawlRemainderMs += milliseconds;
    rounds = Math.floor(state.arcaneTime.crawlRemainderMs / SPELL_ROUND_MS);
    state.arcaneTime.crawlRemainderMs %= SPELL_ROUND_MS;
  }
  if ((hasFaith || hasItems) && rounds > 0) {
    advanceTransformationRounds(state, rounds); advanceAreaSpells(state, rounds);
    cleanupWizardTierTwoFocus(state); syncTransformationEffects(state); syncAreaSpellConditions(state);
    advancePortalRounds(state, rounds);
    advancePotionRounds(state, rounds);
    advanceConcealmentRounds(state,rounds);
    for(const monster of state.entities)if(monster.moraleFlight) {monster.moraleFlight.rounds-=rounds;if(monster.moraleFlight.rounds<=0)delete monster.moraleFlight;}
    advanceFaithRounds(state, rounds);
    if (crawlingTurns) for (let round = 0; round < rounds; round++) {
      for (const character of state.characters) if (character.focusSpell) recordFocusCheck(character, 'next round');
      for (const monster of getLiveMonsters()) for (const result of resolveDetectThoughtsResistance(state, monster, tierTwoOptions()))
        pushDiceHistory('Detect Thoughts', result.message);
    }
    syncAllCharacterEquipmentDerivedStats();
  }
  const changed = advanceWizardTime(state, milliseconds, { rounds, summon: summonMishapMonster,
    onTurn: character => {
      if (armoredIds.has(character.id) && !mageArmorEffect(character)) {
        syncCharacterEquipmentDerivedStats(character);
        armoredIds.delete(character.id);
      }
      return crawlingTurns && recordWizardTurn(character);
    },
    onScream: character => {
      if (noiseIsSilenced(state, character)) return;
      const result = maybeSpawnWanderingMonster(state, monsterTable, { ignoreDarkness: true, allowUnlit: true,
        origin: character, seedOffset: state.arcaneTime.elapsedMs + (state.wanderingMonsters?.spawnedCount || 0) * 7919 });
      const message = `${character.name} screams in Primordial. ${result.message}`;
      pushDiceHistory('Wizard mishap: screaming', message, character.id);
      if (result.spawned) {
        result.entity.attitude = 'combat'; result.entity.attitudeChecked = true; result.entity.hostile = true;
        addMonstersToCombat([result.entity], 'Screaming attracts a wandering monster.');
      }
    }
  });
  if (changed) { syncAllCharacterEquipmentDerivedStats(); if (lightingMayChange) recomputeVisibility(state); markRunDirty(); }
  return discsChanged || changed || ((hasFaith || hasItems) && rounds > 0);
}

function syncFloatingDiscFollowers() {
  if (!state?.characters.some(isFloatingDisc)) return false;
  const moves = followFloatingDiscs(state, (x, y, nextX, nextY, point) => canMoveBetweenTiles(state, x, y, nextX, nextY, { ignorePits: true, routeId: point?.routeId }).ok);
  if (SERVER_RUNTIME) for (const { disc, before } of moves) {
    const frames = serverFollowerFrames.get(disc.id) || [before];
    frames.push({ x: disc.x, y: disc.y, roomId: disc.roomId, routeId: routeOf(state, disc) });
    serverFollowerFrames.set(disc.id, frames);
  }
  return moves.length > 0;
}

function progressFloatingDiscTime(milliseconds) {
  const expired = advanceFloatingDiscTime(state, milliseconds);
  for (const disc of expired) {
    const tile = { x: disc.x, y: disc.y, roomId: disc.roomId, routeId: routeOf(state, disc) };
    for (const [index, item] of (disc.gear || []).entries()) {
      const pile = createDroppedGearEntity({ ...item, equipped: false }, tile,
        item.lit && getGearLightSource(item) ? getGearLightSource(item) : '');
      pile.id = `${disc.id}-cargo-${index}`;
      state.entities.push(pile);
    }
    for (const coin of ['gold', 'silver', 'copper']) if (getCharacterMoney(disc, coin) > 0) {
      const pile = createCoinPileEntity(disc, coin, getCharacterMoney(disc, coin));
      Object.assign(pile, tile, { id: `${disc.id}-coins-${coin}` }); state.entities.push(pile);
    }
    state.characters = state.characters.filter(member => member.id !== disc.id);
    if (state.activeCharacterId === disc.id) {
      state.activeCharacterId = state.characters.find(member => member.id === disc.summon.casterId)?.id || state.characters.find(member => !isFloatingDisc(member))?.id || null;
      syncPlayerToActiveCharacter();
    }
    if (!SERVER_RUNTIME && ui.characterSheetContent.dataset.characterId === disc.id) closeCharacterSheet();
  }
  if (expired.length) { markRunDirty(); recomputeVisibility(state); setStatus('Floating Disc expires; its contents fall to the dungeon floor.'); }
  return expired.length > 0;
}

function syncCriticalSpellDialog() {
  if (SERVER_RUNTIME) return;
  syncMagicMissileUi();
  syncFaithSpellUi();
  const modal = document.getElementById('spell-critical-modal');
  const caster = state?.characters.find(character => character.pendingSpell?.spell === 'cure wounds' && canControlCharacter(character));
  const wasHidden = modal.hidden;
  modal.hidden = !caster;
  modal.dataset.characterId = caster?.id || '';
  if (!caster) return;
  const target = state.characters.find(character => character.id === caster.pendingSpell.targetId);
  document.getElementById('spell-critical-target').textContent = `${caster.name} heals ${target?.name || 'the target'}.`;
  for (const button of modal.querySelectorAll('button')) button.disabled = sharedCommandPending > 0;
  if (wasHidden) modal.querySelector('button')?.focus();
}

function syncFaithSpellUi() {
  const modal = document.getElementById('faith-critical-modal');
  const caster = state.characters.find(character => (FAITH_SPELLS.has(character.pendingSpell?.spell)||WIZARD_TIER_ONE.has(character.pendingSpell?.spell)||character.pendingSpell?.spell==='invisibility') && canControlCharacter(character));
  if (caster) { ui.spellDetailModal.hidden=true; ui.characterSheetModal.hidden=true; }
  const critical = caster?.pendingSpell.phase === 'critical';
  const wasHidden = modal.hidden;
  modal.hidden = !critical;
  modal.dataset.characterId = caster?.id || '';
  if (critical) {
    const spellKey = caster.pendingSpell.spell;
    document.getElementById('faith-critical-title').textContent = findSpellRecord(spellKey).name + ': Critical Success';
    if (modal.dataset.spellKey !== spellKey) {
      modal.dataset.spellKey = spellKey;
      const choices = document.getElementById('faith-critical-choices'); choices.replaceChildren();
      for (const [choice,label] of FAITH_CRITICAL_CHOICES[spellKey]||WIZARD_CRITICAL_CHOICES[spellKey]||[['duration','20 Rounds'],['range','10-Foot Range']]) {
        const button = document.createElement('button'); button.type='button'; button.textContent=label;
        button.dataset.criticalChoice = choice;
        button.addEventListener('click',()=>finishFaithSpell(state.characters.find(character=>character.id===modal.dataset.characterId),{choice}));
        choices.append(button);
      }
    }
    for (const button of modal.querySelectorAll('button')) button.disabled = sharedCommandPending > 0 ||
      caster.pendingSpell.spell === 'floating disc' && button.dataset.criticalChoice === 'two-discs' && floatingDiscSlotsAvailable(state, caster.id) < 2;
    if (wasHidden) modal.querySelector('button')?.focus();
  }
  const panel = document.getElementById('holy-weapon-panel');
  panel.hidden = !['holy weapon','invisibility','charm person','hold portal','sleep'].includes(caster?.pendingSpell.spell) || caster.pendingSpell.phase !== 'targeting';
  document.getElementById('holy-weapon-title').textContent=findSpellRecord(caster?.pendingSpell?.spell)?.name || 'Holy Weapon';
  panel.querySelector('p').textContent=caster?.pendingSpell?.spell==='charm person'?`Pick ${caster.pendingSpell.remaining > 1 ? 'two humanoids' : 'a humanoid'} of level ${caster.pendingSpell.maxLevel} or less.`:
    caster?.pendingSpell.spell==='invisibility'?'Pick a creature to make invisible.':
    caster?.pendingSpell.spell==='hold portal'?'Pick a door to hold closed.':
    caster?.pendingSpell.spell==='sleep'?`Pick a direction for the ${caster.pendingSpell.size} by ${caster.pendingSpell.size} Sleep square.`:'Pick a character with an equipped weapon.';
  panel.dataset.characterId = caster?.id || '';
  document.getElementById('holy-weapon-discard').onclick = ()=>finishFaithSpell(caster,{dismiss:true});
}

function startTurnedUndeadCombat(caster, outcome) {
  const fleeing = (outcome.results || []).filter(result => result.fled);
  for (const result of fleeing) {
    const monster = getMonsterById(result.id);
    if (monster) { monster.attitude='combat'; monster.hostile=true; monster.attitudeChecked=true; }
  }
  if (fleeing.length && !isCombatActive()) {
    caster.openingSpellActionSpent=true;
    beginCombat('Undead flee from the priest.');
    if (!isCombatActive()) caster.openingSpellActionSpent=false;
  }
}

function finishFaithSpell(character, {choice,targetId,x,y,dismiss=false}={}) {
  if (sendSharedCommand('resolve_spell',{choice,target_id:targetId,x,y,dismiss},character)) return;
  const caster = getCurrentCharacter(character);
  try {
    let outcome;
    if(WIZARD_TIER_ONE.has(caster.pendingSpell?.spell)) {
      outcome = resolveWizardTierOne(state, caster, { choice, targetId, x, y, dismiss });
      if (outcome.target) {
        removeCharmedMonsterFromCombat(outcome.target.id);
        joinFriendlyMonster(outcome.target, caster, 'charmed');
      }
    }
    else if(caster.pendingSpell?.spell==='invisibility')outcome=resolveInvisibility(state,caster,{choice,targetId,dismiss});
    else if (dismiss && caster.pendingSpell?.spell === 'holy weapon' && caster.pendingSpell.phase === 'targeting') {
      caster.pendingSpell=null; outcome={message:'Unused Holy Weapon dissipates. The casting action remains spent.'};
    } else outcome=resolveFaithSpell(state,caster,{choice,targetId});
    startTurnedUndeadCombat(caster, outcome);
    syncAllCharacterEquipmentDerivedStats(); checkCombatEnd(); recomputeVisibility(state);
    markRunDirty(); markUserActivity(); setStatus(outcome.message);
    pushDiceHistory('Spell effect',outcome.message,caster.id);
    syncCriticalSpellDialog(); updatePanels(); render(); scheduleAutoEndTurnIfNeeded();
  } catch(error) { if(SERVER_RUNTIME)throw error;setStatus(error.message); }
}

function finishCriticalHealing(character, choice) {
  if (sendSharedCommand('resolve_spell', { choice }, character)) return;
  const caster = getCurrentCharacter(character);
  try {
    const outcome = resolveCureWounds(state, caster, choice);
    setStatus(outcome.message);
    pushDiceHistory('Cure Wounds healing', outcome.message, caster.id);
    markRunDirty();
    markUserActivity();
    refreshOpenCharacterSheet(caster);
    syncCriticalSpellDialog();
    render();
  } catch (error) {
    if (SERVER_RUNTIME) throw error;
    setStatus(error.message);
  }
}

function performPenance(character, spellKey = 'cure wounds') {
  if (sendSharedCommand('penance', { spell_name: spellKey }, character)) return;
  const current = getCurrentCharacter(character);
  const entry = current?.spellPenance?.[spellKey];
  const fail = message => { if (SERVER_RUNTIME) throw new Error(message); setStatus(message); };
  if (!current || !canControlCharacter(current) || !isCharacterAbleToAct(current) || isCombatActive() || restInProgress(state)) return fail('Penance is unavailable right now.');
  if (!entry || entry.paid) return fail('No unpaid ' + (findSpellRecord(spellKey)?.name || spellKey) + ' penance remains.');
  const coins = getCharacterMoneyCopper(current), assets = ensurePartyAssets(), party = getMoneyCopper(assets);
  if (coins + party < 500) return fail('Penance requires 5 Gold from character coins and Party Assets.');
  const personal = Math.min(coins, 500);
  setCharacterMoneyFromCopper(current, coins - personal);
  setMoneyFromCopper(assets, party - (500 - personal));
  entry.paid = true;
  markRunDirty();
  markUserActivity();
  setStatus(`${current.name} sacrifices 5 Gold. ${findSpellRecord(spellKey)?.name || spellKey} will return after a successful rest.`);
  refreshOpenCharacterSheet(current);
  renderSpellDetail(findSpellRecord(spellKey), current);
}

function updateRestUi() {
  if (SERVER_RUNTIME || !state) return;
  const rest = state.rest;
  if (rest?.phase === 'completed' && rest.studyResults?.length) {
    const results = rest.studyResults.filter(result => ownsCharacter(state.characters.find(character => character.id === result.characterId)));
    const resultKey = `${state.seed}:${rest.nextHourAt}`;
    if (results.length && modalStudyResultKey !== resultKey) {
      modalStudyResultKey = resultKey;
      showNotice(results.map(result => result.message).join('\n'));
    }
  }
  const active = restInProgress(state);
  const supplies=restSupplyStatus(state);
  let unavailable='';
  if(!active)try{restingParty(state);}catch(error){unavailable=error.message;}
  const memberId = isSharedRoom() ? multiplayerSession.current_player_id : 'solo';
  const needsConsent = rest?.phase === 'voting' && rest.requiredMemberIds.includes(memberId) && !rest.acceptedMemberIds.includes(memberId);
  const modal = document.getElementById('rest-modal');
  const completed = rest?.phase === 'completed';
  if (completed && modalRestResultKey !== `${state.seed}:${rest.nextHourAt}`) {
    modalRestResultKey = `${state.seed}:${rest.nextHourAt}`;
    modal.dataset.showResults = 'true';
    modal.hidden = false;
  } else if (!completed) modal.dataset.showResults = 'false';
  const showingResults = completed && modal.dataset.showResults === 'true';
  const status = rest?.phase === 'sleeping' && restTourFrame(rest.scene).active ? 'Setting Alarm around the room...'
    : rest?.phase === 'voting' ? `Waiting for players: ${rest.acceptedMemberIds.length}/${rest.requiredMemberIds.length} accepted.`
    : rest?.phase === 'sleeping' ? `You've slept for ${rest.hours} of 8 hours.` : rest?.message || '';
  const progress = document.getElementById('rest-progress');
  progress.hidden = !status;
  progress.textContent = status;
  if (needsConsent) modal.hidden = false;
  const safe = active ? rest.safe : state.characters.length > 0 && state.characters.filter(c => !isFloatingDisc(c) && !isCharacterDead(c)).every(isCharacterInStartingRoom);
  document.getElementById('rest-warning').hidden = safe || showingResults;
  document.getElementById('rest-description').textContent = showingResults ? rest.message : active ? status : supplies.reusing
    ? `Resume rest at ${rest.hours} of 8 hours? Supplies already paid.`
    : `This will use 3 torches and ${supplies.partySize} rations. Begin rest?`;
  const results = document.getElementById('rest-results');
  results.hidden = !showingResults || !rest.failedNames?.length;
  results.replaceChildren();
  if (showingResults) for (const name of rest.failedNames || []) {
    const item = document.createElement('p');
    item.textContent = `${name} couldn't get back to sleep and gains no benefit from resting.`;
    results.append(item);
  }
  const schedule = document.getElementById('rest-watch-schedule');
  schedule.hidden = showingResults || !(active || supplies.reusing);
  schedule.replaceChildren();
  const watchCurrent = document.getElementById('rest-watch-current');
  watchCurrent.hidden = rest?.phase !== 'sleeping';
  if (!schedule.hidden) for (const shift of restWatchSchedule(state)) {
    const row = document.createElement('p');
    const names = shift.characterIds.map(id => state.characters.find(character => character.id === id)?.name).filter(Boolean);
    row.textContent = `Hours ${shift.firstHour}-${shift.lastHour}: ${names.join(', ') || 'Nobody on watch'}`;
    row.classList.toggle('is-on-watch', rest.phase === 'sleeping' && rest.hours + 1 >= shift.firstHour && rest.hours + 1 <= shift.lastHour);
    schedule.append(row);
  }
  if (!watchCurrent.hidden) watchCurrent.textContent = `On watch: ${restWatchCharacters(state).map(character => character.name).join(', ') || 'Nobody'}`;
  const alarmPanel = document.getElementById('rest-alarm');
  alarmPanel.replaceChildren();
  alarmPanel.hidden = showingResults || rest?.phase === 'sleeping';
  if (!alarmPanel.hidden) {
    const roomId = state.characters.find(character => !isFloatingDisc(character) && !isCharacterDead(character))?.roomId;
    const alarm = [state.preparedAlarm, ['voting', 'interrupted'].includes(rest?.phase) ? rest.alarm : null]
      .filter(entry => entry?.roomId === roomId).sort((a, b) => b.encounterDivisor - a.encounterDivisor)[0];
    if (alarm) {
      const message = document.createElement('p');
      message.textContent = `Alarm: no surprise; wandering monster chance ${alarm.encounterDivisor === 4 ? 'quartered' : 'halved'}.`;
      alarmPanel.append(message);
    }
    for (const caster of state.characters.filter(character => !isFloatingDisc(character) &&
      /wizard/i.test(character.className) && getCharacterKnownSpellNames(character).some(name => getSpellKey(name) === 'alarm'))) {
      const row = document.createElement('div'); row.className = 'rest-alarm-row';
      const name = document.createElement('span'); name.textContent = `${caster.name}: Alarm`;
      const cast = document.createElement('button'); cast.type = 'button'; cast.textContent = 'Cast';
      cast.disabled = sharedCommandPending > 0 || !ownsCharacter(caster) || !isCharacterAbleToAct(caster) ||
        Boolean(caster.pendingSpell) || isCharacterSpellFailed(caster, findSpellRecord('alarm')) ||
        Boolean(unavailable) || isCombatActive() || (isSharedRoom() && !multiplayerSession.can_explore);
      cast.addEventListener('click', () => performRestAlarm(caster));
      row.append(name, cast); alarmPanel.append(row);
    }
    alarmPanel.hidden = !alarmPanel.childElementCount;
  }
  const confirm = document.getElementById('rest-confirm');
  confirm.hidden = showingResults || active && !needsConsent;
  confirm.textContent = needsConsent ? 'Accept Rest' : 'Yes';
  confirm.disabled = sharedCommandPending > 0 || isCombatActive() || (!active&&Boolean(unavailable));
  document.getElementById('rest-close').textContent=active||showingResults?'Close':'No';
  document.getElementById('rest-cancel').hidden = !active;
  if (rest?.phase === 'interrupted' && isCombatActive()) modal.hidden = true;
  const restButton = document.getElementById('rest-btn');
  restButton.disabled = isCombatActive() || (!active&&Boolean(unavailable)) || (isSharedRoom() && !multiplayerSession.can_explore);
  restButton.title=!active&&!supplies.sufficient?`you need 3 torches and ${supplies.partySize} rations to rest`:unavailable;
}

function performRestAction(type, command = {}) {
  if (isSharedRoom()) {
    flushSharedMoveBuffer(true);
    void executeSharedCommand({ type, character_id: inventoryController(getActiveCharacter(state))?.id,
      ...(type === 'rest' ? { watch_order_ids: currentRestMarchingOrder() } : {}) }).catch(() => {});
    return;
  }
  try {
    let message;
    if (type === 'rest') {
      message = beginPartyRest(state, { memberId: command.rest_member_id || 'solo',
        requiredMemberIds: command.rest_member_ids || ['solo'], safe: state.characters.filter(c => !isFloatingDisc(c) && !isCharacterDead(c)).every(isCharacterInStartingRoom),
        watchOrderIds: command.watch_order_ids || (SERVER_RUNTIME ? [] : currentRestMarchingOrder()),
        ownership: command.rest_ownership || {}, memberIds: command.rest_member_order || [] });
    } else if (type === 'rest_accept') message = acceptPartyRest(state, command.rest_member_id || 'solo');
    else message = cancelPartyRest(state);
    if (state.rest?.phase === 'sleeping') for (const character of state.characters) character.focusSpell=null;
    syncAllCharacterEquipmentDerivedStats();
    syncPlayerToActiveCharacter();
    syncPlayerLightFromActiveCharacter();
    recomputeVisibility(state);
    markRunDirty();
    markUserActivity();
    setStatus(message);
    updatePanels();
    render();
  } catch (error) {
    if (SERVER_RUNTIME) throw error;
    setStatus(error.message);
    document.getElementById('rest-description').textContent = error.message;
  }
}

function performRestAlarm(character) {
  if (sendSharedCommand('rest_alarm', {}, character)) return;
  const caster = getCurrentCharacter(character);
  try {
    if (!caster || !ownsCharacter(caster) || !isCharacterAbleToAct(caster) ||
      (isSharedRoom() && !multiplayerSession.can_explore) || isCombatActive() || state.rest?.phase === 'sleeping') {
      throw new Error('Cast Alarm while preparing rest, outside combat.');
    }
    const spell = findSpellRecord('alarm');
    if (!caster.castingScroll && (!/wizard/i.test(caster.className) ||
      !getCharacterKnownSpellNames(caster).some(name => getSpellKey(name) === 'alarm') || isCharacterSpellFailed(caster, spell))) {
      throw new Error('Alarm is unavailable to this caster.');
    }
    restingParty(state);
    const outcome = castWizardTierOne(state, caster, 'alarm', {
      advantage: characterHasSpellCastingAdvantage(caster, spell), disadvantage: protectionDisadvantage(state, caster)
    });
    markRunDirty(); markUserActivity(); setStatus(outcome.message);
    pushDiceHistory('Alarm cast', outcome.message, caster.id);
    recomputeVisibility(state); updatePanels(); render();
    if (!SERVER_RUNTIME) {
      ui.spellDetailModal.hidden = true; ui.characterSheetModal.hidden = true;
      document.getElementById('rest-modal').hidden = false;
    }
  } catch (error) { if (SERVER_RUNTIME) throw error; setStatus(error.message); }
}

function progressPartyRest() {
  if (state.rest?.phase !== 'sleeping') return false;
  recomputeVisibility(state);
  let encounterId = null;
  const message = advancePartyRest(state, { onHour: () => {
    progressWizardEffects(60 * 60 * 1000);
    for(const monster of state.entities)if(monster.curious){monster.curious.remainingMs-=3600000;if(monster.curious.remainingMs<=0){delete monster.curious;monster.attitude='neutral';}}
  }, encounter: hour => {
    const result = maybeSpawnWanderingMonster(state, monsterTable, { ignoreDarkness: true,
      chanceDivisor: state.rest.alarm?.encounterDivisor,
      seedOffset: Math.floor(state.rest.nextHourAt) + hour * 7919 });
    if (!result.spawned) return false;
    result.entity.attitude = 'combat';
    result.entity.attitudeChecked = true;
    result.entity.hostile = true;
    encounterId = result.entity.id;
    return true;
  } });
  if (!message) return false;
  if (state.rest.phase === 'interrupted' && !isCombatActive()) {
    recordRestInterruptionChecks();
    beginCombat('Wandering monsters interrupt the party\'s rest!', { extraMonsterIds: encounterId ? [encounterId] : [] });
  }
  if(state.rest.phase==='completed')triggerPartyDoppelgangers();
  if (state.rest.phase === 'completed') for (const result of state.rest.studyResults || []) {
    pushDiceHistory('Scroll study', `${result.message}. INT ${result.check.total} vs DC 15.`, result.characterId);
  }
  syncAllCharacterEquipmentDerivedStats();
  syncPlayerLightFromActiveCharacter();
  recomputeVisibility(state);
  markRunDirty();
  setStatus(message);
  return true;
}

function recordRestInterruptionChecks() {
  for (const entry of state.rest.interruptionChecks || []) {
    pushDiceHistory('Rest interruption', `${entry.name}: 1d20 = (${entry.result.roll}) ${formatSignedModifier(entry.result.modifier)} CON = ${entry.result.total} vs DC 12: ${entry.passed ? 'passed' : 'failed; no benefit from this eight-hour rest'}.`, entry.characterId);
  }
}

function luckActorRef(actor) { return { collection: state.characters.includes(actor) ? 'characters' : 'entities', id: actor.id }; }
function captureLuckActor(event, actor) {
  captureRuntimeLuckActor(state, event, actor);
  captureLuckChange(state, event, luckActorRef(actor), ['invisibility', 'lightSpellLit', 'lightSource']);
}
function performLuck(character) {
  if (sendSharedCommand('luck', {}, character)) return;
  if (!ownsCharacter(character)) throw new Error('This Luck Token is not yours.');
  const outcome = consumeLuck(state, { ownerId: character.id, applyOutcome: (draft, info) => {
    const { event, check, succeeded, actor, target } = info;
    if (event.kind === 'party-attack') {
      if (!succeeded) return { message: `${actor.name}'s attack still misses (${check.total}).` };
      if (!target) return { message: `${actor.name} still attacks nothing (${check.total}).` };
      const multiplier = (event.context.backstab || 1) * (event.context.paralyzed || check.roll === 20 ? 2 : 1);
      const damage = rollDamageExpression(multiplier > 1 ? multiplyDamageDice(event.context.expression, multiplier) : event.context.expression);
      if (event.context.elementalDice) damage.total += rollDamageExpression(event.context.elementalDice).total;
      const total = elementalDamage(target, damage.total, event.context.element || '').total;
      if (event.context.feature) {
        target.hp = Math.max(0, (Number.isFinite(target.hp) ? target.hp : event.context.door ? 15 : 10) - total);
        if (!target.hp) {
          if (event.context.door) { setDoorState(target, 'gone'); delete target.holdPortal; }
          else { target.destroyed = true; target.visible = false; target.collected = true; }
        }
      } else if (draft.characters.includes(target)) setCharacterHp(target, Number(target.hp) - total, { sourceId: actor.id });
      else { target.hp = Math.max(0, target.hp - total); wakeCreature(target, draft); }
      return { message: `${actor.name}'s rerolled attack hits ${target.name}: ${check.total}. Damage: ${total}.` };
    }
    if (event.kind === 'monster-attack') {
      if (succeeded && event.context.damage) setCharacterHp(target, Number(target.hp) - event.context.damage, { sourceId: actor.id });
      return { message: `${actor.name}'s rerolled attack ${succeeded ? 'still hits' : 'misses'} ${target.name}: ${check.total}.` };
    }
    if (event.kind === 'cast') {
      const key = event.context.spell;
      actor.failedSpellKeys = (actor.failedSpellKeys || []).filter(name => name !== key);
      const options = { checkRoll: () => check, rollCheck: () => check, knownSpells: getCharacterKnownSpellNames(actor), monsterAttacks: getMonsterAttackOptions };
      let result;
      if (event.context.focus) {
        const maintain = key === 'levitate' ? maintainLevitationFocus : isTierTwoFocus(actor.focusSpell) ? maintainTierTwoFocus : key === 'detect magic' ? maintainDetectMagic : maintainFocus;
        result = maintain(draft, actor, { ...options, reason: event.context.reason, turnKey: `luck:${event.id}`,
          criticalChoices: TIER_TWO_CHOICES, grantLuck: (world, owner) => grantLuckToken(world, owner.id),
          onCriticalChoice: (world, owner, focus, choice) => {
            const zone = world.areaSpells?.find(area => area.id === focus.areaId);
            if (zone && choice === 'area') { zone.x -= 3; zone.y -= 3; zone.width = zone.height = 12; }
          } });
      } else if (TIER_TWO_SPELLS.has(key)) result = castTierTwoSpell(draft, actor, key, options);
      else if (WIZARD_TIER_ONE.has(key)) result = castWizardTierOne(draft, actor, key, options);
      else if (FAITH_SPELLS.has(key)) result = castFaithSpell(draft, actor, key, options);
      else if (key === 'invisibility') result = castInvisibility(draft, actor, options);
      else if (key === 'light') result = castLight(draft, actor, options);
      else if (key === 'cure wounds') result = castCureWounds(draft, actor, event.context.targetId, options);
      else if (key === 'magic missile') result = castMagicMissile(draft, actor, options);
      else if (key === 'burning hands') result = castBurningHands(draft, actor, options);
      else throw new Error('That spell does not yet support a Luck reroll.');
      return { message: result.message };
    }
    if (event.kind === 'save') return resolveLuckSave(draft, info, { resolvePitSave,
      canStep: (world, creature, x, y, nx, ny) => canMoveBetweenTiles(world, x, y, nx, ny, { creature, routeId: routeOf(world, creature), ignorePits: true }).ok });
    throw new Error('That saving throw cannot be rerolled yet.');
  } });
  for (const monster of state.entities.filter(entity => entity.type === 'monster' && !entity.defeated && Number(entity.hp) <= 0)) defeatMonster(state, monster);
  syncTransformationEffects(state); syncAreaSpellConditions(state); syncAllCharacterEquipmentDerivedStats();
  syncPlayerToActiveCharacter(); recomputeVisibility(state); prepareEncounterState(); checkCombatEnd();
  const message = outcome.result?.message || `Luck reroll: ${outcome.check.roll}.`;
  pushDiceHistory('Luck', message, character.id); setStatus(message); markRunDirty(); updatePanels(); render();
}

function spellLuckOptions(caster, spell) {
  const check = (modifier, options) => {
    const result = rollCheck(modifier, options);
    if (spellLuckContext && !spellLuckContext.event && !isLuckResolution(state) && !caster.castingScroll) {
      const context = spellLuckContext;
      context.event = beginLuckEvent(state, { kind: 'cast', actor: luckActorRef(caster), roll: result, dc: 10 + Number(spell.tier || 1),
        context: { spell: getSpellKey(spell), targetId: context.targetId }, scope: [...state.characters, ...state.entities.filter(entity => entity.type === 'monster')].map(luckActorRef) });
      for (const actor of [...state.characters, ...state.entities.filter(entity => entity.type === 'monster')]) captureLuckActor(context.event, actor);
      captureLuckChange(state, context.event, luckActorRef(caster), ['spellPenance']);
      context.result = result;
    }
    return result;
  };
  return { checkRoll: check, rollCheck: check };
}
function performSpellCast(character, spell, targetId = null) {
  const previous = spellLuckContext, context = { targetId };
  spellLuckContext = context;
  try { return performSpellCastInternal(character, spell, targetId); }
  finally {
    spellLuckContext = previous;
    if (context.event) finishLuckEvent(state, context.event, { succeeded: context.result.roll !== 1 && (context.result.roll === 20 || context.result.total >= 10 + Number(spell.tier || 1)) });
  }
}
function performSpellCastInternal(character, spell, targetId = null) {
  if (getSpellKey(spell) === 'alarm') { performRestAlarm(character); return; }
  if (sendSharedCommand("spell", { spell_name: spell?.name, target_id: targetId }, character)) {
    if (FAITH_SPELLS.has(getSpellKey(spell)) || getSpellKey(spell) === 'light') { ui.spellDetailModal.hidden=true; ui.characterSheetModal.hidden=true; ui.spellcastingModal.hidden=true; }
    return;
  }
  const currentCharacter = getCurrentCharacter(character) || getActiveCharacter(state);
  if (!currentCharacter || !spell) {
    return;
  }
  if (!isCharacterAbleToAct(currentCharacter) || !canControlCharacter(currentCharacter) || isCharacterSpellFailed(currentCharacter, spell)) return;
  if(currentCharacter.companion?.kind==='doppelganger'){setStatus('This character cannot cast spells.');return;}
  if (hasReadyOffensiveSpell(currentCharacter) && currentCharacter.pendingSpell.spell === getSpellKey(spell)) {
    setStatus(pendingSpellMessage(currentCharacter));
    if (!SERVER_RUNTIME && OFFENSIVE_SPELLS.has(getSpellKey(spell))) openOffensiveSpellTargeting(currentCharacter, getSpellKey(spell));
    return;
  }
  const blockedBySilence = silenceBlocksAction(state, currentCharacter, { spellcasting: true });
  if (blockedBySilence) { if (SERVER_RUNTIME) throw new Error(blockedBySilence); setStatus(blockedBySilence); return; }
  if (/focus/i.test(spell.duration || '') && getSpellKey(spell) !== 'protection from evil') {
    currentCharacter.focusSpell = null; cleanupWizardTierTwoFocus(state); syncTransformationEffects(state); syncAreaSpellConditions(state);
  }
  currentCharacter.castFromConcealment = isStealthed(currentCharacter);
  revealAfterOffense(currentCharacter);
  if (TIER_TWO_SPELLS.has(getSpellKey(spell))) {
    try {
      if (!SERVER_RUNTIME && !consumeCharacterCombatAction(currentCharacter, { teleport: getSpellKey(spell) === 'misty step' })) return;
      const outcome = castTierTwoSpell(state, currentCharacter, getSpellKey(spell), { ...tierTwoOptions(),
        ...spellLuckOptions(currentCharacter, spell),
        advantage: characterHasSpellCastingAdvantage(currentCharacter, spell), disadvantage: protectionDisadvantage(state, currentCharacter) });
      syncTransformationEffects(state); syncAreaSpellConditions(state); cleanupWizardTierTwoFocus(state);
      syncAllCharacterEquipmentDerivedStats(); recomputeVisibility(state);
      markRunDirty(); markUserActivity(); setStatus(outcome.message); showCheckResult(outcome.check, spell.name + ' cast', { message: outcome.message });
      if (!SERVER_RUNTIME) { ui.spellDetailModal.hidden = true; ui.characterSheetModal.hidden = true; ui.spellcastingModal.hidden = true; }
      updatePanels(); render(); scheduleAutoEndTurnIfNeeded();
    } catch (error) { if (SERVER_RUNTIME) throw error; setStatus(error.message); }
    return;
  }
  if (getSpellKey(spell) === 'light') {
    try {
      if (!SERVER_RUNTIME && !consumeCharacterCombatAction(currentCharacter)) return;
      const outcome = castLight(state, currentCharacter, { ...spellLuckOptions(currentCharacter, spell), advantage: characterHasSpellCastingAdvantage(currentCharacter, spell), disadvantage: protectionDisadvantage(state, currentCharacter) });
      if (!SERVER_RUNTIME && outcome.succeeded) { ui.spellDetailModal.hidden = true; ui.characterSheetModal.hidden = true; ui.spellcastingModal.hidden = true; }
      markRunDirty(); markUserActivity(); setStatus(outcome.message); showCheckResult(outcome.check, 'Light cast', { message: outcome.message });
      updatePanels(); render(); scheduleAutoEndTurnIfNeeded();
    } catch (error) { if (SERVER_RUNTIME) throw error; setStatus(error.message); }
    return;
  }
  if (WIZARD_TIER_ONE.has(getSpellKey(spell))) {
    try {
      const falling = getSpellKey(spell) === 'feather fall';
      if (!SERVER_RUNTIME && !falling && !consumeCharacterCombatAction(currentCharacter)) return;
      const outcome = castWizardTierOne(state, currentCharacter, getSpellKey(spell), {
        ...spellLuckOptions(currentCharacter, spell),
        advantage: characterHasSpellCastingAdvantage(currentCharacter, spell), disadvantage: protectionDisadvantage(state, currentCharacter) });
      syncAllCharacterEquipmentDerivedStats();
      prepareEncounterState();
      markRunDirty(); markUserActivity(); setStatus(outcome.message);
      showCheckResult(outcome.check, spell.name + ' cast', { message: outcome.message });
      if (!SERVER_RUNTIME) { ui.spellDetailModal.hidden = true; ui.characterSheetModal.hidden = true; }
      syncCriticalSpellDialog(); updatePanels(); render(); scheduleAutoEndTurnIfNeeded();
    } catch (error) { if (SERVER_RUNTIME) throw error; setStatus(error.message); }
    return;
  }
  if(getSpellKey(spell)==='invisibility') {
    try {
      if(!SERVER_RUNTIME&&!consumeCharacterCombatAction(currentCharacter))return;
      revealAfterOffense(currentCharacter);
      const outcome=castInvisibility(state,currentCharacter,{...spellLuckOptions(currentCharacter,spell),advantage:characterHasSpellCastingAdvantage(currentCharacter,spell),disadvantage:protectionDisadvantage(state,currentCharacter)});
      markRunDirty();markUserActivity();setStatus(outcome.message);showCheckResult(outcome.check,'Invisibility cast',{message:outcome.message});
      if(!SERVER_RUNTIME){ui.spellDetailModal.hidden=true;ui.characterSheetModal.hidden=true;}
      syncCriticalSpellDialog();updatePanels();render();
    }catch(error){if(SERVER_RUNTIME)throw error;setStatus(error.message);}return;
  }
  if (FAITH_SPELLS.has(getSpellKey(spell))) {
    try {
      if (getSpellKey(spell) === 'turn undead' && !(currentCharacter.gear || []).some(item => /holy symbol/i.test(item.name))) throw new Error('Turn Undead requires a holy symbol.');
      if (!SERVER_RUNTIME && !consumeCharacterCombatAction(currentCharacter)) return;
      const outcome = castFaithSpell(state, currentCharacter, getSpellKey(spell), { ...spellLuckOptions(currentCharacter, spell), advantage: characterHasSpellCastingAdvantage(currentCharacter, spell) });
      startTurnedUndeadCombat(currentCharacter, outcome);
      syncAllCharacterEquipmentDerivedStats(); recomputeVisibility(state); checkCombatEnd();
      markRunDirty(); markUserActivity(); setStatus(outcome.message);
      showCheckResult(outcome.check, spell.name + ' cast', { message: outcome.message });
      if (!SERVER_RUNTIME) { ui.spellDetailModal.hidden = true; ui.characterSheetModal.hidden = true; }
      syncCriticalSpellDialog(); updatePanels(); render(); scheduleAutoEndTurnIfNeeded();
    } catch (error) { if (SERVER_RUNTIME) throw error; setStatus(error.message); }
    return;
  }
  if (OFFENSIVE_SPELLS.has(getSpellKey(spell))) {
    try {
      if (!SERVER_RUNTIME && !consumeCharacterCombatAction(currentCharacter)) return;
      const cast = getSpellKey(spell) === 'magic missile' ? castMagicMissile : castBurningHands;
      const outcome = cast(state, currentCharacter, { knownSpells: getCharacterKnownSpellNames(currentCharacter),
        ...spellLuckOptions(currentCharacter, spell),
        disadvantage: protectionDisadvantage(state, currentCharacter),
        advantage: characterHasSpellCastingAdvantage(currentCharacter, spell) });
      if (outcome.mishaps?.length) {
        state.arcaneTime ||= { elapsedMs: 0, crawlRemainderMs: 0 };
        state.arcaneTime.crawlRemainderMs = 0;
      }
      for (const character of state.characters) {
        clearMagicLightIfIncapacitated(character);
        syncCharacterDyingRaw(character);
      }
      for (const hit of (outcome.mishaps || []).flatMap(mishap => mishap.hits || [])) {
        if (hit.type === 'monster' && hit.defeated) defeatMonster(state, getMonsterById(hit.id));
      }
      if (isCurrentCharacterTurn(currentCharacter) && !isCharacterAbleToAct(currentCharacter)) {
        state.combat.movementRemaining = 0;
        state.combat.actionUsed = true;
      }
      syncAllCharacterEquipmentDerivedStats();
      syncPlayerLightFromActiveCharacter();
      recomputeVisibility(state);
      markUserActivity(); markRunDirty();
      setStatus(outcome.message);
      showCheckResult(outcome.check, spell.name + ' cast', { message: outcome.message });
      refreshOpenCharacterSheet(currentCharacter);
      if (!SERVER_RUNTIME && outcome.succeeded) openOffensiveSpellTargeting(currentCharacter, getSpellKey(spell));
      syncMagicMissileUi();
      scheduleAutoEndTurnIfNeeded();
      render();
    } catch (error) {
      if (SERVER_RUNTIME) throw error;
      setStatus(error.message);
    }
    return;
  }
  if (getSpellKey(spell) === 'cure wounds') {
    try {
      validateCureWoundsTarget(state, currentCharacter, targetId);
      if (!SERVER_RUNTIME && !consumeCharacterCombatAction(currentCharacter)) return;
      const outcome = castCureWounds(state, currentCharacter, targetId, { ...spellLuckOptions(currentCharacter, spell), advantage: characterHasSpellCastingAdvantage(currentCharacter, spell), disadvantage: protectionDisadvantage(state, currentCharacter) });
      markUserActivity();
      markRunDirty();
      setStatus(outcome.message);
      showCheckResult(outcome.check, 'Spell', { message: outcome.message });
      refreshOpenCharacterSheet(currentCharacter);
      renderSpellDetail(spell, currentCharacter);
      syncCriticalSpellDialog();
      render();
    } catch (error) {
      if (SERVER_RUNTIME) throw error;
      setStatus(error.message);
    }
    return;
  }
  if (!SERVER_RUNTIME && !consumeCharacterCombatAction(currentCharacter)) return;

  const modifier = getSpellCastingModifier(currentCharacter, spell);
  const dc = getSpellCastingDc(spell);
  const hasAdvantage = characterHasSpellCastingAdvantage(currentCharacter, spell);
  const advantageLabel = hasAdvantage
    ? getSpellKey(spell) === "magic missile" ? "Magic Missile" : "Talent"
    : "";
  const result = rollCheck(modifier, wizardCastingMode(currentCharacter, Number(spell.tier), hasAdvantage, protectionDisadvantage(state, currentCharacter)));
  const succeeded = result.roll !== 1 && (result.roll === 20 || result.total >= dc);
  const characterName = currentCharacter.name || "The caster";
  let message = succeeded
    ? `${characterName} casts ${spell.name}!`
    : `${characterName} fails to cast ${spell.name}!`;
  let sighting = null;

  if (!succeeded) {
    markCharacterSpellFailed(currentCharacter, spell);
    if (result.roll === 1) {
      if (/wizard/i.test(currentCharacter.className)) {
        const mishaps = rollWizardMishaps(state, currentCharacter, getSpellKey(spell), higherMishapContext(currentCharacter, spell, targetId));
        message += ' ' + mishaps.map(mishap => `${mishap.name}: ${mishap.detail}`).join(' ');
        for (const monster of [...state.entities].filter(entity => entity.type === 'monster' && !entity.defeated && Number(entity.hp) <= 0)) defeatMonster(state, monster);
        syncAllCharacterEquipmentDerivedStats(); recomputeVisibility(state); prepareEncounterState(); checkCombatEnd();
      }
      else currentCharacter.spellPenance[getSpellKey(spell)] = { paid: false };
    }
  } else if (getSpellKey(spell) === "light") {
    lightNewTorch(state);
    setCharacterLight(currentCharacter, "light-spell");
    syncPlayerLightFromActiveCharacter();
    recomputeVisibility(state);
    sighting = processMonsterVisibilityChange();
  }

  markUserActivity();
  if (state?.run) {
    state.run.dirty = true;
  }
  if (!sighting?.combatStarted && !sighting?.combatEnded) {
    setStatus(message);
  }
  showCheckResult(result, "Spell", {
    headline: `${result.total} spell check`,
    message,
    context: {
      doubleRoll: hasAdvantage,
      advantageClass: advantageLabel
    }
  });
  refreshOpenCharacterSheet(currentCharacter);
  renderSpellDetail(spell, currentCharacter);
}

function setDamageDetailVisibility(visible) {
  if (!ui.damageDetail || !ui.damageExpandBtn) {
    return;
  }
  ui.damageDetail.hidden = !visible;
  ui.damageExpandBtn.textContent = visible ? "collapse" : "expand";
}

function formatSignedModifier(modifier) {
  const normalized = Number(modifier) || 0;
  return normalized >= 0 ? `+${normalized}` : `${normalized}`;
}

function clampNumber(value, min, max, fallback) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, parsed));
}

function formatTwoDigitInputValue(value) {
  const normalized = Number(value) || 0;
  const sign = normalized < 0 ? "-" : "";
  return `${sign}${String(Math.abs(normalized)).padStart(2, "0")}`;
}

function getDiceHistoryAgeLabel(index) {
  if (index === 0) {
    return "most recent";
  }
  if (index === 1) {
    return "1 roll ago";
  }
  return `${index} rolls ago`;
}

let diceHistoryRenderKey = '';
let rollTooltip = null;
function appendRollSegments(target, segments) {
  for (const segment of segments) {
    const node = document.createElement(segment.bold ? 'strong' : 'span'); node.textContent = segment.text;
    if (segment.maximum) node.classList.add('die-maximum');
    else if (segment.minimum) node.classList.add('die-minimum');
    else if (segment.characterId) {
      const character = state.characters.find(member => member.id === segment.characterId);
      if (character) node.style.color = getCharacterColorValue(character);
    } else if (!segment.bold) { node.textContent = ''; appendCharacterColoredText(node, segment.text); }
    if (Array.isArray(segment.tooltip)) {
      node.classList.add('roll-hover-value'); node.tabIndex = 0;
      node.setAttribute('aria-label', segment.tooltip.map(part => part.text).join(''));
      const close = () => { rollTooltip?.remove(); rollTooltip = null; };
      const show = () => {
        close(); rollTooltip = document.createElement('div'); rollTooltip.className = 'roll-hover-tooltip';
        rollTooltip.setAttribute('role', 'tooltip'); appendRollSegments(rollTooltip, segment.tooltip); document.body.append(rollTooltip);
        const rect = node.getBoundingClientRect(), tip = rollTooltip.getBoundingClientRect();
        rollTooltip.style.left = `${Math.max(8, Math.min(window.innerWidth - tip.width - 8, rect.left))}px`;
        rollTooltip.style.top = `${Math.max(8, rect.top >= tip.height + 12 ? rect.top - tip.height - 8 : Math.min(window.innerHeight - tip.height - 8, rect.bottom + 8))}px`;
      };
      node.addEventListener('pointerenter', show); node.addEventListener('pointerleave', close);
      node.addEventListener('focus', show); node.addEventListener('blur', close);
    }
    target.append(node);
  }
}

function renderDiceHistory() {
  if (SERVER_RUNTIME) return;
  if (!ui.diceHistory) {
    return;
  }
  if (ui.diceHistoryToggle) {
    ui.diceHistoryToggle.hidden = diceHistory.length === 0;
  }
  const key = JSON.stringify([diceHistory, state.characters.map(character => [character.id, getCharacterColorValue(character)])]);
  if (diceHistoryRenderKey === key && ui.diceHistory.childElementCount === diceHistory.length) return;
  diceHistoryRenderKey = key; rollTooltip?.remove(); rollTooltip = null;
  ui.diceHistory.innerHTML = "";
  diceHistory.forEach((entry, index) => {
    const item = document.createElement("li");
    const detail = document.createElement("div");
    detail.className = "dice-history-detail";
    if (Array.isArray(entry.segments)) appendRollSegments(detail, entry.segments);
    else appendCharacterColoredText(detail, entry.detail || entry.label || '');
    item.append(detail);
    ui.diceHistory.append(item);
  });
}

function appendCharacterColoredText(target, value) {
  const names = (state?.characters || []).filter(character => character.name).sort((a, b) => b.name.length - a.name.length);
  let offset = 0;
  while (offset < value.length) {
    const matches = names.map(character => ({ character, index: value.indexOf(character.name, offset) })).filter(match => match.index >= 0).sort((a, b) => a.index - b.index);
    const match = matches[0];
    if (!match) { target.append(document.createTextNode(value.slice(offset))); break; }
    target.append(document.createTextNode(value.slice(offset, match.index)));
    const span = document.createElement('strong');
    span.textContent = match.character.name;
    span.style.color = getCharacterColorValue(match.character);
    target.append(span);
    offset = match.index + match.character.name.length;
  }
}

function characterSheetInteractionKey(character) {
  return `${state.combat?.active}:${getCurrentCombatEntry()?.id}:${state.combat?.actionUsed}:${canControlCharacter(character)}`;
}

function pushDiceHistory(label, detail, characterId = null, segments = null) {
  if (!segments) { const parsed = rollTextSegments(detail || label || ''); if (parsed.length > 1) segments = parsed; }
  diceHistory = Array.isArray(state?.rollHistory) ? state.rollHistory : diceHistory;
  diceHistory.unshift({ label, detail, characterId, ...(segments ? { segments } : {}) });
  diceHistory = diceHistory.slice(0, 100);
  if (state) state.rollHistory = diceHistory;
  renderDiceHistory();
}

function toggleDiceHistory() {
  if (!ui.diceHistory || !ui.diceHistoryToggle) {
    return;
  }
  const isOpening = ui.diceHistory.hidden;
  ui.diceHistory.hidden = !isOpening;
  ui.diceHistoryToggle.setAttribute("aria-expanded", `${isOpening}`);
  ui.diceHistoryToggle.textContent = isOpening ? "Hide Roll History" : "Roll History";
}

function rollManualDie(sides, count, modifier) {
  const rolls = Array.from({ length: count }, () => Math.floor(Math.random() * sides) + 1);
  const diceTotal = rolls.reduce((sum, value) => sum + value, 0);
  return {
    kind: "manual",
    sides,
    count,
    modifier,
    rolls,
    total: diceTotal + modifier
  };
}

function applyManualDieRoll(button) {
  const sides = Number.parseInt(button.dataset.dieSides || "0", 10);
  if (!Number.isFinite(sides) || sides <= 0 || !ui.damageResult) {
    return;
  }
  const countInput = ui.manualDieCount;
  const modifierInput = ui.manualDieModifier;
  const count = clampNumber(countInput?.value, 1, 99, 1);
  const modifier = clampNumber(modifierInput?.value, -99, 99, 0);
  if (sendSharedCommand("roll", { sides, count, modifier })) return;
  countInput.value = formatTwoDigitInputValue(count);
  modifierInput.value = formatTwoDigitInputValue(modifier);
  sizeControlField(countInput);
  sizeControlField(modifierInput);

  lastDamageRoll = rollManualDie(sides, count, modifier);
  const label = button.textContent.trim();
  ui.damageResult.textContent = `${lastDamageRoll.total}`;
  ui.damageContext.textContent = `${String(count).padStart(2, "0")} ${label} ${formatSignedModifier(modifier)}`;
  renderDamageDetail(lastDamageRoll);
  setDamageDetailVisibility(false);
  pushDiceHistory(`${lastDamageRoll.total}`, `${String(count).padStart(2, "0")} ${label} ${formatSignedModifier(modifier)}\n${lastDamageRoll.rolls.join(" + ")} = ${lastDamageRoll.total}`);
}

function resetManualDieControls() {
  if (ui.manualDieCount) {
    ui.manualDieCount.value = "01";
    sizeControlField(ui.manualDieCount);
  }
  if (ui.manualDieModifier) {
    ui.manualDieModifier.value = "00";
    sizeControlField(ui.manualDieModifier);
  }
}

function createCheckRollToken(value, kept = false) {
  const token = document.createElement(kept ? "strong" : "span");
  token.className = "damage-breakdown-term";
  if (value === 1) {
    token.classList.add("is-minimum");
  }
  if (value === 20) {
    token.classList.add("is-maximum");
  }
  token.textContent = `${value}`;
  return token;
}

function createStrongText(value) {
  const token = document.createElement("strong");
  token.textContent = value;
  return token;
}

function renderCheckDetail(roll) {
  const result = roll?.result;
  if (!result || !ui.damageDetail) {
    return;
  }

  const line = document.createElement("div");
  line.className = "damage-breakdown-line";
  const classNote = roll.advantageClass
    ? ` ${roll.advantageClass.charAt(0).toUpperCase()}${roll.advantageClass.slice(1)}`
    : "";
  const checkMode = result.checkMode === "disadvantage" ? "disadvantage" : result.secondaryRoll ? "advantage" : "";
  line.append(document.createTextNode(`${roll.actionLabel} check${checkMode ? ` at ${checkMode}${classNote}` : ""}: `));

  if (Number.isFinite(result.secondaryRoll)) {
    const kept = checkMode === "disadvantage"
      ? Math.min(result.firstRoll, result.secondaryRoll)
      : Math.max(result.firstRoll, result.secondaryRoll);
    line.append(createCheckRollToken(result.firstRoll, result.firstRoll === kept));
    line.append(document.createTextNode(", "));
    line.append(createCheckRollToken(result.secondaryRoll, result.secondaryRoll === kept));
  } else {
    line.append(createCheckRollToken(result.roll, true));
  }

  line.append(document.createTextNode(" "));
  line.append(createStrongText(formatSignedModifier(result.modifier)));
  line.append(document.createTextNode(" = "));
  line.append(createStrongText(`${result.total}`));
  ui.damageDetail.append(line);
}

function renderDamageDetail(roll) {
  if (!ui.damageDetail) {
    return;
  }
  ui.damageDetail.innerHTML = "";
  if (!roll) {
    ui.damageDetail.hidden = true;
    return;
  }
  if (roll.kind === "check") {
    renderCheckDetail(roll);
    return;
  }
  if (roll.kind === "manual") {
    const line = document.createElement("div");
    line.className = "damage-breakdown-line";
    roll.rolls.forEach((value, index) => {
      if (index > 0) {
        line.append(document.createTextNode(" + "));
      }
      const token = document.createElement("span");
      token.className = "damage-breakdown-term";
      if (value === 1) {
        token.classList.add("is-minimum");
      }
      if (value === roll.sides) {
        token.classList.add("is-maximum");
      }
      token.textContent = `${value}`;
      line.append(token);
    });
    if (roll.modifier !== 0) {
      line.append(document.createTextNode(roll.modifier > 0 ? ` + ${roll.modifier}` : ` - ${Math.abs(roll.modifier)}`));
    }
    line.append(document.createTextNode(` = ${roll.total}`));
    ui.damageDetail.append(line);
    return;
  }

  const line = document.createElement("div");
  line.className = "damage-breakdown-line";
  roll.terms.forEach((term, index) => {
    if (index > 0) {
      line.append(document.createTextNode(term.sign < 0 ? " - " : " + "));
    } else if (term.sign < 0) {
      line.append(document.createTextNode("-"));
    }

    if (term.type === "die") {
      const token = document.createElement("span");
      token.className = "damage-breakdown-term";
      if (term.isMinimum) {
        token.classList.add("is-minimum");
      }
      if (term.isMaximum) {
        token.classList.add("is-maximum");
      }
      token.textContent = `${term.label}: ${term.value}`;
      line.append(token);
      return;
    }

    line.append(document.createTextNode(String(term.value)));
  });

  if (roll.multiplier > 1) {
    line.append(document.createTextNode(`, then x ${roll.multiplier}`));
  }
  line.append(document.createTextNode(` = ${roll.total}`));
  ui.damageDetail.append(line);
}

function applyDamageRoll(reference, sourceLabel = "", options = {}) {
  const expression = normalizeDamageExpression(reference?.expression);
  if (!expression || !ui.damageResult) {
    return;
  }
  if (sendSharedCommand("roll", { expression }, options.character || getActiveCharacter(state))) return;
  const roll = rollDamageExpression(expression);
  lastDamageRoll = {
    ...roll,
    display: reference?.display || expression,
    sourceLabel
  };
  ui.damageResult.textContent = `${roll.total} ${options.resultLabel || "Damage"}`;
  ui.damageContext.textContent = sourceLabel
    ? `${sourceLabel}: ${reference?.display || expression}`
    : (reference?.display || expression);
  renderDamageDetail(lastDamageRoll);
  setDamageDetailVisibility(false);
  pushDiceHistory(`${roll.total} ${options.resultLabel || "Damage"}`, [sourceLabel, reference?.display || expression].filter(Boolean).join("\n"), options.character?.id, damageRollSegments(sourceLabel, roll));
}

function parseSpellCheckModifier(expression, character, contextText) {
  const normalized = normalizeDamageExpression(expression);
  const modifierMatch = normalized.match(/^1d20([+\-]\d+)?$/i);
  if (modifierMatch) {
    return Number.parseInt(modifierMatch[1] || "0", 10) || 0;
  }
  if (/\bpriest\s+spell\b/i.test(contextText)) {
    return abilityScoreModifier(character?.stats?.WIS);
  }
  if (/\bwizard\s+spell\b/i.test(contextText)) {
    return abilityScoreModifier(character?.stats?.INT);
  }
  return 0;
}

function parseGenericSpellTier(contextText) {
  const tierMatch = String(contextText || "").match(/\bTier\s+(\d+)\b/i);
  return Math.max(1, Number.parseInt(tierMatch?.[1] || "1", 10) || 1);
}

function applyGenericSpellCheck(reference, options = {}) {
  if (!ui.damageResult) {
    return;
  }
  const contextText = String(options.contextText || reference?.context || "");
  const character = getCurrentCharacter(options.character) || getActiveCharacter(state);
  const tier = parseGenericSpellTier(contextText);
  const modifier = parseSpellCheckModifier(reference?.expression, character, contextText);
  if (sendSharedCommand("roll", { sides: 20, count: 1, modifier }, character)) return;
  const result = rollCheck(modifier);
  const characterName = character?.name || "The caster";
  const succeeded = result.total >= 10 + tier;
  const message = succeeded
    ? `${characterName} casts a Tier ${tier} spell!`
    : `${characterName} fails to cast a Tier ${tier} spell`;

  markUserActivity();
  setStatus(message);
  showCheckResult(result, "Spell", {
    headline: `${result.total} spell check:`,
    message
  });
}

function shouldTreatAsSpellCheck(reference, text, options = {}) {
  const expression = normalizeDamageExpression(reference?.expression);
  return (
    options.spellCheck === true ||
    (
      /^1d20(?:[+\-]\d+)?$/i.test(expression) &&
      /\b(?:wizard|priest)\s+spell\b/i.test(String(text || reference?.context || ""))
    )
  );
}

function createDamageButton(reference, options = {}) {
  if (!options.spellCheck && options.character) {
    const value = document.createElement('span'); value.className = 'damage-value';
    value.textContent = options.label || reference.expression; return value;
  }
  const button = document.createElement("button");
  button.type = "button";
  button.className = "damage-token";
  button.textContent = options.label || reference.expression;
  button.title = `Roll ${reference.display || reference.expression}`;
  button.disabled = isSharedRoom() && !options.character;
  button.addEventListener("click", (event) => {
    event.stopPropagation();
    if (options.spellCheck) {
      applyGenericSpellCheck(reference, options);
      return;
    }
    applyDamageRoll(reference, options.sourceLabel || "", {
      resultLabel: "Damage", character: options.character
    });
  });
  return button;
}

function appendDamageAwareText(target, text, options = {}) {
  const value = String(text || "");
  const references = Array.isArray(options.references) && options.references.length
    ? options.references
    : extractDamageReferences(value, { preferDeathLabel: options.preferDeathLabel === true });
  if (!references.length) {
    target.append(document.createTextNode(value));
    return;
  }

  const referenceMap = new Map();
  references.forEach((reference) => {
    const key = normalizeDamageExpression(reference.expression);
    if (key && !referenceMap.has(key)) {
      referenceMap.set(key, reference);
    }
  });

  let cursor = 0;
  for (const match of value.matchAll(/\b(?:\d+d\d+(?:\s*(?:\+\s*\d+|x\s*\d+|\*\s*\d+))*|d\d+)\b/gi)) {
    const matchText = match[0];
    const index = match.index ?? 0;
    if (index > cursor) {
      target.append(document.createTextNode(value.slice(cursor, index)));
    }
    const expression = normalizeDamageExpression(matchText);
    const reference = referenceMap.get(expression) || {
      expression,
      display: expression,
      context: value
    };
    const spellCheck = shouldTreatAsSpellCheck(reference, value, options);
    target.append(createDamageButton(reference, {
      label: matchText,
      sourceLabel: options.sourceLabel || "",
      spellCheck,
      contextText: value,
      character: options.character
    }));
    cursor = index + matchText.length;
  }

  if (cursor < value.length) {
    target.append(document.createTextNode(value.slice(cursor)));
  }
}

function createDamageAwareLine(text, options = {}) {
  const content = document.createElement("span");
  appendDamageAwareText(content, text, options);
  return content;
}

function spellMenuCastReason(character, spell) {
  if (!spell) return 'Spell details are unavailable.';
  if (!character || !state.characters.some(item => item.id === character.id)) return 'This character is no longer in the party.';
  if (!canControlCharacter(character)) return 'Only the owning player can cast on this character\'s turn.';
  if (!isCharacterAbleToAct(character)) return 'This character cannot cast right now.';
  if (state.encounterPrompt) return 'Resolve the monster reaction first.';
  if (isCharacterSpellFailed(character, spell)) return 'This spell is unavailable until recovery.';
  if (character.pendingSpell) {
    if (hasReadyOffensiveSpell(character) && character.pendingSpell.spell === getSpellKey(spell)) return '';
    return pendingSpellMessage(character);
  }
  if (getSpellKey(spell) === 'feather fall') return character.pendingFall ? '' : 'Available when falling.';
  if (isCombatActive() && state.combat.actionUsed) return 'This character has already acted this turn.';
  if (getSpellKey(spell) === 'cure wounds' && !state.characters.some(target => canReceiveHealing(target) && canTouchCharacter(state, character, target))) return 'No healing target is within touch range.';
  return '';
}

function renderSpellcastingMenu(character) {
  const caster = state.characters.find(item => item.id === character?.id);
  if (!caster) { ui.spellcastingModal.hidden = true; return; }
  ui.spellcastingModal.dataset.characterId = caster.id;
  document.getElementById('spellcasting-title').textContent = `${caster.name}: Spellcasting`;
  const names = [...new Set(getCharacterKnownSpellNames(caster).filter(name => !/^none$/i.test(name)))];
  const rows = names.map(name => ({ name, spell: findSpellRecord(name) })).sort((a, b) => Number(a.spell?.tier || 0) - Number(b.spell?.tier || 0) || a.name.localeCompare(b.name));
  const key = JSON.stringify(rows.map(({ name, spell }) => [name, spellMenuCastReason(caster, spell), caster.pendingSpell?.spell === getSpellKey(name)]));
  if (ui.spellcastingList.dataset.renderKey === key) return;
  const focused = document.activeElement.closest?.('.spellcasting-row');
  const focusedName = focused?.dataset.spellName;
  const focusedAction = document.activeElement.dataset.spellAction;
  ui.spellcastingList.dataset.renderKey = key;
  ui.spellcastingList.replaceChildren();
  for (const { name, spell } of rows) {
    const row = document.createElement('div');
    row.className = 'spellcasting-row';
    row.dataset.spellName = name;
    const description = document.createElement('button');
    description.type = 'button';
    description.className = 'spellcasting-name';
    description.textContent = name;
    description.dataset.spellAction = 'description';
    description.title = `View ${name}`;
    description.classList.toggle('is-spell-lost', isCharacterSpellFailed(caster, name));
    description.disabled = !spell;
    description.addEventListener('click', () => {
      ui.spellcastingModal.hidden = true;
      renderSpellDetail(spell, getCurrentCharacter(caster));
    });
    const cast = document.createElement('button');
    cast.type = 'button';
    cast.className = 'spell-cast-button';
    cast.textContent = 'Cast';
    cast.dataset.spellAction = 'cast';
    const reason = spellMenuCastReason(caster, spell);
    const ready = hasReadyOffensiveSpell(caster) && caster.pendingSpell.spell === getSpellKey(name);
    cast.disabled = Boolean(reason);
    cast.title = reason || (ready ? 'Choose targets for this already-cast spell.' : `Cast ${name} against DC ${getSpellCastingDc(spell)}`);
    row.classList.toggle('is-spell-ready', ready);
    cast.addEventListener('click', () => {
      const current = getCurrentCharacter(caster);
      const unavailable = spellMenuCastReason(current, spell);
      if (unavailable) { setStatus(unavailable); renderSpellcastingMenu(current); return; }
      if (!activateCharacter(current)) return;
      ui.spellcastingModal.hidden = true;
      if (getSpellKey(spell) === 'cure wounds') renderSpellDetail(spell, current);
      else performSpellCast(current, spell);
    });
    row.append(description, cast);
    ui.spellcastingList.append(row);
  }
  if (!rows.length) {
    const empty = document.createElement('p');
    empty.textContent = 'No spells known.';
    ui.spellcastingList.append(empty);
  }
  if (focusedName) {
    const row = [...ui.spellcastingList.children].find(item => item.dataset.spellName === focusedName);
    row?.querySelector(`[data-spell-action="${focusedAction}"]`)?.focus();
  }
}

async function openSpellcastingMenu(character) {
  try {
    await ensureSpellLibraryLoaded();
    const caster = getCurrentCharacter(character);
    if (!caster) return;
    ui.spellcastingList.dataset.renderKey = '';
    renderSpellcastingMenu(caster);
    ui.spellcastingModal.hidden = false;
    document.getElementById('spellcasting-close').focus();
  } catch (error) { setStatus(`Spellcasting could not be opened: ${error.message}`); }
}

function closeSpellcastingMenu() {
  ui.spellcastingModal.hidden = true;
  const id = ui.spellcastingModal.dataset.characterId;
  [...ui.charactersList.children].find(card => card.dataset.characterId === id)?.querySelector('.spellcasting-menu-button')?.focus();
}

function renderSpellDetail(spell, character, { scrollIndex = null, readOnly = false } = {}) {
  if (SERVER_RUNTIME) return;
  ui.spellDetailModal.classList.toggle('is-advancement-preview', readOnly);
  const currentCharacter = getCurrentCharacter(character) || getActiveCharacter(state);
  const previousTarget = ui.spellDetailModal.dataset.characterId === currentCharacter?.id && ui.spellDetailModal.dataset.spellKey === getSpellKey(spell)
    ? ui.spellDetailBody.querySelector('select')?.value : null;
  ui.spellDetailModal.dataset.characterId = currentCharacter?.id || '';
  ui.spellDetailModal.dataset.spellKey = getSpellKey(spell);
  const fromScroll = Number.isInteger(scrollIndex);
  const failed = !fromScroll && isCharacterSpellFailed(currentCharacter, spell);
  ui.spellDetailTitle.textContent = spell.name.toUpperCase();
  ui.spellDetailTitle.classList.toggle("is-spell-lost", failed);
  ui.spellDetailMeta.textContent = `Tier ${spell.tier}, ${spell.classes.join(", ")}`;
  ui.spellDetailDuration.textContent = spell.duration || "Unknown";
  ui.spellDetailRange.textContent = spell.range || "Unknown";
  ui.spellDetailBody.innerHTML = "";
  const lockRemaining = spellLockRemaining(currentCharacter, getSpellKey(spell));
  if (lockRemaining > 0) {
    const note = document.createElement('p');
    note.textContent = `Mind wound: ${Math.ceil(lockRemaining / (60 * 60 * 1000))} in-game hours remain. A successful rest is also required.`;
    ui.spellDetailBody.append(note);
  }

  if (!readOnly && failed && currentCharacter?.spellPenance?.[getSpellKey(spell)]) {
    const penance = document.createElement('button');
    penance.type = 'button';
    penance.textContent = currentCharacter.spellPenance[getSpellKey(spell)].paid ? 'Penance Paid; Rest Required' : 'Sacrifice 5 Gold';
    penance.disabled = currentCharacter.spellPenance[getSpellKey(spell)].paid || !canControlCharacter(currentCharacter) || isCombatActive() || restInProgress(state);
    penance.addEventListener('click', () => performPenance(currentCharacter, getSpellKey(spell)));
    ui.spellDetailBody.append(penance);
  }

  if (!readOnly && !failed && currentCharacter) {
    const castActions = document.createElement("div");
    castActions.className = "spell-detail-actions";
    let targetPicker = null;
    if (getSpellKey(spell) === 'cure wounds') {
      const label = document.createElement('label');
      label.textContent = 'Heal: ';
      targetPicker = document.createElement('select');
      targetPicker.setAttribute('aria-label', 'Cure Wounds target');
      const targets = state.characters.filter(target => canReceiveHealing(target) && canTouchCharacter(state, currentCharacter, target));
      for (const target of targets) {
        const option = document.createElement('option');
        option.value = target.id;
        option.textContent = `${target.name}${target.id === currentCharacter.id ? ' (self)' : ''}: ${target.hp}/${target.maxHitPoints} HP`;
        targetPicker.append(option);
      }
      if (targets.some(target => target.id === previousTarget)) targetPicker.value = previousTarget;
      label.append(targetPicker);
      castActions.append(label);
    }
    const castButton = document.createElement("button");
    castButton.type = "button";
    castButton.className = "spell-cast-button";
    const wand = fromScroll && currentCharacter.gear[scrollIndex]?.magic?.kind === 'wand';
    castButton.textContent = fromScroll ? wand ? 'Use Wand' : 'Read Scroll' : 'Cast';
    castButton.title = `Cast ${spell.name} against DC ${getSpellCastingDc(spell)}`;
    castButton.disabled = !canControlCharacter(currentCharacter) || !isCharacterAbleToAct(currentCharacter) || Boolean(currentCharacter.pendingSpell) ||
      (wand && currentCharacter.gear[scrollIndex]?.magic?.disabledUntilRest) ||
      (getSpellKey(spell) === 'feather fall' && !currentCharacter.pendingFall) ||
      (isCombatActive() && state.combat.actionUsed) || (targetPicker && !targetPicker.options.length);
    castButton.addEventListener("click", () => fromScroll ? performMagicGearAction(wand ? 'read_wand' : 'read_scroll', currentCharacter, scrollIndex, targetPicker?.value) : performSpellCast(currentCharacter, spell, targetPicker?.value));
    castActions.append(castButton);
    ui.spellDetailBody.append(castActions);
  }

  spell.paragraphs.forEach((paragraph) => {
    const item = document.createElement("p");
    if (readOnly || getSpellKey(spell) === 'magic missile') item.textContent = paragraph;
    else appendDamageAwareText(item, paragraph, {
      references: (spell.damage || []).filter((reference) => paragraph.includes(reference.expression) || reference.context.includes(reference.expression)),
      preferDeathLabel: true,
      sourceLabel: spell.name
    });
    ui.spellDetailBody.append(item);
  });
  if (currentCharacter && characterHasSpellCastingAdvantage(currentCharacter, spell)) {
    const advantageNote = document.createElement("p");
    advantageNote.className = "spell-advantage-note";
    advantageNote.textContent = wizardCastingMode(currentCharacter, Number(spell.tier), true).doubleRoll
      ? 'You have advantage on casting this spell.' : 'Advantage and mishap disadvantage cancel: roll normally.';
    ui.spellDetailBody.append(advantageNote);
  }
  ui.spellDetailModal.hidden = false;
}

function createSpellButton(spellName, options = {}) {
  const button = document.createElement("a");
  button.href = '#spell-description';
  button.className = "spell-link-button";
  button.textContent = spellName;
  if (isCharacterSpellFailed(options.character, spellName)) {
    button.classList.add("is-spell-lost");
  }
  button.addEventListener("click", async event => {
    event.preventDefault();
    event.stopPropagation();
    await ensureSpellLibraryLoaded();
    const spell = findSpellRecord(spellName);
    if (!spell) {
      setStatus(`No spell details found for ${spellName}.`);
      return;
    }
    renderSpellDetail(spell, options.character);
  });
  return button;
}

function createSpellSummaryLine(text, character) {
  const container = document.createElement("div");
  container.className = "sd-spell-summary-line";
  const prefix = document.createElement("strong");
  prefix.className = "sd-line-prefix";
  prefix.textContent = "Spells:";
  prefix.title = fieldLore('Spells', character?.className);
  container.append(prefix);

  const payload = String(text || "").replace(/^Spells:\s*/i, "").trim();
  if (!payload || /^none$/i.test(payload)) {
    container.append(document.createTextNode("None"));
    return container;
  }

  const groups = new Map();
  for (const group of payload.split(/\s*;\s*/).filter(Boolean)) {
    const match = group.match(/^\(Tier\s+(\d+)\):\s*(.+)$/i);
    const tier = match?.[1] || "";
    const names = (match?.[2] || group)
      .split(/\s*,\s*/)
      .map((value) => value.trim())
      .filter(Boolean);
    const bucket = groups.get(tier) || new Map();
    for (const name of names) if (!bucket.has(name.toLowerCase())) bucket.set(name.toLowerCase(), name);
    groups.set(tier, bucket);
  }
  const sortedGroups = [...groups].sort(([a], [b]) => (Number(a) || Infinity) - (Number(b) || Infinity));
  sortedGroups.forEach(([tier, bucket]) => {
    const section = document.createElement('section');
    section.className = 'sd-spell-tier';
    if (tier) {
      const tierLabel = document.createElement("span");
      tierLabel.className = "sd-spell-tier-label";
      tierLabel.textContent = `Tier ${tier}`;
      section.append(tierLabel);
    }
    const names = document.createElement('div');
    names.className = 'sd-spell-names';
    [...bucket.values()].sort((a, b) => a.localeCompare(b)).forEach((name, index) => {
      if (index > 0) {
        names.append(document.createTextNode(", "));
      }
      const button = createSpellButton(name, { character, tier });
      names.append(button);
    });
    section.append(names);
    container.append(section);
  });

  return container;
}

function createTalentsContent(rows, spellSummary, languageLine, character) {
  const content = document.createElement('div');
  content.className = 'sd-talents-content';
  const talents = document.createElement('section');
  talents.className = 'sd-talents-list';
  const heading = document.createElement('strong');
  heading.textContent = 'Talents:';
  heading.title = fieldLore('Talents');
  talents.append(heading);
  for (const row of rows) {
    const line = document.createElement('div');
    line.append(row);
    talents.append(line);
  }
  if (!rows.length) {
    const line = document.createElement('div');
    line.textContent = 'None';
    talents.append(line);
  }
  content.append(talents);
  if (spellSummary && !/^Spells:\s*None$/i.test(spellSummary)) {
    content.append(createSpellSummaryLine(spellSummary, character));
  }
  const languages = document.createElement('div');
  languages.className = 'sd-sheet-languages';
  languages.textContent = languageLine || 'Languages: None';
  languages.title = fieldLore('Languages');
  content.append(languages);
  return content;
}

function fitCharacterSheetText(target) {
  const fit = (node, minimum) => {
    const initial = Number.parseFloat(getComputedStyle(node).fontSize) || 12;
    node.style.fontSize = `${initial}px`;
    let size = initial;
    while (size > minimum && (node.scrollHeight > node.clientHeight + 1 || node.scrollWidth > node.clientWidth + 1)) {
      size = Math.max(minimum, size - .25);
      node.style.fontSize = `${size}px`;
    }
  };
  for (const node of target.querySelectorAll('.sd-talents-content')) fit(node, 6);
  for (const node of target.querySelectorAll('.sd-sheet-value, .sd-lined-block > div')) fit(node, 6);
}

function createSdField(label, value, className = "") {
  const field = document.createElement("section");
  field.className = ["sd-sheet-field", className].filter(Boolean).join(" ");
  const heading = document.createElement("h3");
  heading.textContent = label;
  const content = document.createElement("div");
  content.className = "sd-sheet-value";
  content.textContent = `${value ?? ""}`;
  field.append(heading, content);
  const lore = sheetLore(label, value) || fieldLore(label, value);
  if (lore) { field.title = lore; heading.title = lore; }
  return field;
}

function buildSheetLines(lines, minimumLines = 1) {
  const block = document.createElement("div");
  block.className = "sd-lined-block";
  const normalized = lines.filter((line) => {
    if (line instanceof Node) {
      return true;
    }
    return String(line || "").trim().length > 0;
  });
  while (normalized.length < minimumLines) {
    normalized.push("");
  }
  for (const [index,line] of normalized.slice(0,minimumLines).entries()) {
    const row = document.createElement("div");
    if (line instanceof Node) {
      row.append(line);
    } else {
      row.textContent = line;
    }
    if(index===minimumLines-1&&normalized.length>minimumLines) {
      row.dataset.fullText=normalized.slice(index).map(value=>value instanceof Node?value.textContent:value).join('\n');
      row.dataset.forceTooltip='true';
    }
    block.append(row);
  }
  return block;
}

function createSdPanel(title, content, className = "") {
  const panel = document.createElement("section");
  panel.className = ["sd-sheet-panel", className].filter(Boolean).join(" ");
  const heading = document.createElement("h3");
  heading.textContent = title;
  heading.title = fieldLore(title);
  panel.append(heading, content);
  return panel;
}

function updateTruncatedSheetTitles(target) {
  for(const node of target.querySelectorAll('.sd-gear-line-label,.sd-free-carry-text,.sd-sheet-value,.sd-lined-block > div')) {
    if (node.closest('.sd-name-box')) { node.removeAttribute('title'); continue; }
    if(node.dataset.forceTooltip||node.scrollWidth>node.clientWidth+1)node.title=node.dataset.fullText||node.textContent.trim();
    else node.removeAttribute('title');
  }
}

function reorderCharacterGear(character,from,to) {
  if(sendSharedCommand('reorder_gear',{from_index:from,to_index:to},character))return;
  const current=getCurrentCharacter(character);
  const free=item=>item?.treasureItem===true&&inferGearItemSlots(item.name,item)===0;
  if(free(current.gear[from])!==free(current.gear[to]))throw new Error('Reorder items within the same gear list.');
  reorderGear(current,from,to);syncCharacterEquipmentDerivedStats(current);
  markRunDirty();refreshCharacterViews(current);updatePanels();render();
}

function enableGearDragging(label,row,character,index,scope) {
  if(!ownsCharacter(character)||/^backpack$/i.test(character.gear[index]?.name||''))return;
  row.dataset.gearIndex=String(index);label.classList.add('sd-gear-drag-label');
  let start=null;
  label.addEventListener('pointerdown',event=>{
    if(event.button!==0)return;
    event.stopPropagation();start={x:event.clientX,y:event.clientY,id:event.pointerId};
    label.setPointerCapture(event.pointerId);
  });
  label.addEventListener('pointerup',event=>{
    if(!start||start.id!==event.pointerId)return;
    event.stopPropagation();const moved=Math.hypot(event.clientX-start.x,event.clientY-start.y)>5;start=null;
    label.releasePointerCapture(event.pointerId);
    if(!moved)return;
    const target=document.elementFromPoint(event.clientX,event.clientY)?.closest('[data-gear-index]');
    if(target&&scope.contains(target))reorderCharacterGear(character,index,Number(target.dataset.gearIndex));
  });
  label.addEventListener('pointercancel',()=>{start=null;});
}

function createSdGearPanel(character) {
  const panel = document.createElement("section");
  panel.className = "sd-sheet-panel sd-gear-panel";
  const headingRow = document.createElement("div");
  headingRow.className = "sd-gear-heading-row";
  const heading = document.createElement("h3");
  heading.textContent = "Gear";
  heading.title=fieldLore('Gear');
  const coinFields = document.createElement("div");
  coinFields.className = "sd-coin-fields";

  const coinFieldConfigs = [
    ["GP", "gold"],
    ["SP", "silver"],
    ["CP", "copper"]
  ];
  for (const [label, key] of coinFieldConfigs) {
    const field = document.createElement("label");
    field.className = "sd-coin-field";
    field.title = fieldLore(label);
    const fieldLabel = document.createElement("span");
    fieldLabel.textContent = label;
    const input = document.createElement("input");
    input.type = "number";
    input.min = "0";
    input.max = `${getCharacterMoney(character, key)}`;
    input.step = "1";
    input.value = `${getCharacterMoney(character, key)}`;
    input.addEventListener("input", () => {
      const currentCharacter = getCurrentCharacter(character);
      if (!currentCharacter) {
        return;
      }
      const nextValue = updateCharacterMoneyField(currentCharacter, key, input.value);
      input.value = `${nextValue}`;
      input.max = `${nextValue}`;
    });
    field.append(fieldLabel, input);
    coinFields.append(field);
  }
  headingRow.append(heading, coinFields);

  const gearBody = document.createElement("div");
  gearBody.className = "sd-gear-body";

  const rows = document.createElement("div");
  rows.className = "sd-gear-lines";
  rows.title = 'Drag items to reorder.';
  const { slots, freeCarry, freeCarryIndices } = getCharacterGearSlots(character, {
    maxSlots: 20,
    excludeBackpack: true
  });
  rows.style.setProperty("--gear-row-count", `${Math.ceil(slots.length / 2)}`);
  slots.forEach((entry, index) => {
    const row = document.createElement("div");
    row.className = entry.available ? "" : "sd-gear-slot-unavailable";
    const item = Number.isInteger(entry.gearIndex) && Array.isArray(character.gear) ? character.gear[entry.gearIndex] : null;
    if (entry.text && entry.primary && Number.isInteger(entry.gearIndex)) {
      row.classList.add("sd-gear-row-has-drop");
      row.tabIndex = 0;
      row.addEventListener("click", (event) => {
        event.stopPropagation();
        rows.querySelectorAll(".is-drop-open").forEach((openRow) => {
          if (openRow !== row) {
            openRow.classList.remove("is-drop-open");
          }
        });
        row.classList.toggle("is-drop-open");
      });
      row.addEventListener("keydown", (event) => {
        if (event.key !== "Enter" && event.key !== " ") {
          return;
        }
        event.preventDefault();
        row.classList.toggle("is-drop-open");
      });
    }
    const label = document.createElement("span");
    label.className = "sd-gear-line-label";
    if (item) {
      if (handItemKind(item) && item.equipped !== true) {
        label.classList.add("is-gear-unreadied");
      }
    }
    label.append(document.createTextNode(`${index + 1}. ${entry.text || ""}`));
    label.dataset.fullText=entry.text||'';
    if(item&&entry.primary)enableGearDragging(label,row,character,entry.gearIndex,rows);
    if (
      entry.text &&
      entry.primary &&
      item &&
      item.lit === true && getGearLightSource(item)
    ) {
      label.append(document.createTextNode(" "), createLightSourceMarker(getGearLightSource(item)));
    }
    row.append(label);
    const gearActions = document.createElement('span');
    gearActions.className = 'sd-gear-row-actions';
    const usable=item&&(isFloatingDisc(character) ? handItemKind(item) === 'lantern' : isShieldItem(item)?canUseShield(character):isWeaponItem(item)?canUseWeapon(character,item):
      isArmorItem(item)?canUseArmor(character,item)&&!isCombatActive():Boolean(handItemKind(item)));
    if (entry.text && entry.primary && item && usable) {
      const toggle = createEquipmentCheckbox(character, entry.gearIndex);
      gearActions.append(toggle);
    }
    if (entry.text && entry.primary && Number.isInteger(entry.gearIndex)) {
      const gearLightSource = getGearLightSource(item);
      if (
        gearLightSource &&
        item.lit !== true &&
        ((gearLightSource === "torch" && canLightTorch(character)) ||
          (gearLightSource === "lantern" && canLightLantern(character)))
      ) {
        const lightButton = document.createElement("button");
        lightButton.type = "button";
        lightButton.className = "sd-gear-drop-button sd-gear-light-button";
        lightButton.textContent = "Light";
        lightButton.addEventListener("click", (event) => {
          event.stopPropagation();
          const currentCharacter = getCurrentCharacter(character);
          if (!activateCharacter(currentCharacter)) return;
          attemptLightSource(gearLightSource, entry.gearIndex);
        });
        gearActions.append(lightButton);
      }
      const dropButton = document.createElement("button");
      dropButton.type = "button";
      dropButton.className = "sd-gear-drop-button";
      dropButton.textContent = "Drop";
      dropButton.addEventListener("click", (event) => {
        event.stopPropagation();
        const currentCharacter = getCurrentCharacter(character);
        const result = dropCharacterGear(currentCharacter, entry.gearIndex);
        markUserActivity();
        setStatus(result);
        refreshCharacterViews(currentCharacter);
        render();
        updatePanels();
      });
      gearActions.append(dropButton);
      if (!isFloatingDisc(character)) addMagicGearControls(row, character, entry.gearIndex);
    }
    if (gearActions.childElementCount) row.append(gearActions);
    rows.append(row);
  });
  const freeCarryPanel = document.createElement("div");
  freeCarryPanel.className = "sd-free-carry";
  const freeCarryHeading = document.createElement("h3");
  freeCarryHeading.textContent = "FREE TO CARRY";
  freeCarryHeading.title = fieldLore('Free to Carry');
  const freeCarryLines = document.createElement("div");
  freeCarryLines.className = "sd-free-carry-lines";
  const freeCarryDisplay = freeCarry;
  for (let index = 0; index < 10; index += 1) {
    const line = document.createElement("div");
    line.className='sd-free-carry-text';
    line.textContent = freeCarryDisplay[index] || "";
    if (index === 0) {
      line.title = fieldLore('Coins');
      line.dataset.forceTooltip = 'true';
      line.dataset.fullText = line.title;
    }
    if(Number.isInteger(freeCarryIndices[index])&&freeCarryIndices[index]>=0)enableGearDragging(line,line,character,freeCarryIndices[index],freeCarryLines);
    freeCarryLines.append(line);
  }
  freeCarryPanel.append(freeCarryHeading, freeCarryLines);

  gearBody.append(rows, freeCarryPanel);
  panel.append(headingRow, gearBody);
  return panel;
}

function createStatBox(label, value) {
  const box = document.createElement("div");
  box.className = "stat-box";
  const heading = document.createElement("div");
  heading.className = "stat-box-label";
  heading.textContent = label;
  const statValue = document.createElement("div");
  statValue.className = "stat-box-value";
  statValue.textContent = `${value ?? ""}`;
  box.append(heading, statValue);
  return box;
}

function createSheetPanel(title, content) {
  const panel = document.createElement("section");
  panel.className = "sheet-panel";
  const heading = document.createElement("h3");
  heading.textContent = title;
  panel.append(heading, content);
  return panel;
}

function buildListBlock(items) {
  const list = document.createElement("div");
  list.className = "sheet-list-block";
  const filtered = items.filter((item) => Boolean(item && String(item).trim()));
  if (!filtered.length) {
    list.textContent = "None";
    return list;
  }
  for (const item of filtered) {
    const line = document.createElement("div");
    line.textContent = item;
    list.append(line);
  }
  return list;
}

function buildTextBlock(text) {
  const block = document.createElement("div");
  block.className = "sheet-text-block";
  block.textContent = text || "None";
  return block;
}

function createCompactInputField(label, value, max, onChange) {
  const field = document.createElement("label");
  field.className = "compact-input-field";
  const text = document.createElement("span");
  text.textContent = label;
  const input = document.createElement("input");
  input.type = "number";
  input.min = "0";
  input.max = `${max}`;
  input.value = `${value}`;
  input.addEventListener("change", () => onChange(input.value));
  field.append(text, input);
  return field;
}

function getLootCoinCount(loot) {
  return Math.max(0, Number(loot?.coinBreakdown?.gold || 0))
    + Math.max(0, Number(loot?.coinBreakdown?.silver || 0))
    + Math.max(0, Number(loot?.coinBreakdown?.copper || 0));
}

function getCoinEntityKey(loot) {
  const breakdown = loot?.coinBreakdown || {};
  if (Number(breakdown.gold || 0) > 0) {
    return "gold";
  }
  if (Number(breakdown.silver || 0) > 0) {
    return "silver";
  }
  return "copper";
}

function getCoinEntityAmount(loot, key = getCoinEntityKey(loot)) {
  return Math.max(0, Math.floor(Number(loot?.coinBreakdown?.[key] || 0) || 0));
}

function getCoinEntityCpLabel(loot) {
  return `${getCoinBreakdownCopper(loot?.coinBreakdown)} cp`;
}

function isFloorCoinEntity(loot) {
  return /^dropped-(gold|silver|copper)$/.test(String(loot?.subtype || ""));
}

function findCoinCounterpart(loot, key = getCoinEntityKey(loot)) {
  const wantFloor = !isFloorCoinEntity(loot);
  return state.entities.find((entity) => (
    entity !== loot &&
    sameRoute(state, entity, loot) &&
    entity.type === "treasure" &&
    entity.kind === "coin-cache" &&
    !entity.collected &&
    entity.x === loot.x &&
    entity.y === loot.y &&
    entity.roomId === loot.roomId &&
    getCoinEntityKey(entity) === key &&
    isFloorCoinEntity(entity) === wantFloor
  )) || null;
}

function refreshCoinEntity(entity, key = getCoinEntityKey(entity)) {
  if (!entity) {
    return;
  }
  entity.coinBreakdown = entity.coinBreakdown || { gold: 0, silver: 0, copper: 0 };
  entity.coinBreakdown.gold = key === "gold" ? getCoinEntityAmount(entity, "gold") : 0;
  entity.coinBreakdown.silver = key === "silver" ? getCoinEntityAmount(entity, "silver") : 0;
  entity.coinBreakdown.copper = key === "copper" ? getCoinEntityAmount(entity, "copper") : 0;
  const amount = getCoinEntityAmount(entity, key);
  entity.value = getCoinBreakdownCopper(entity.coinBreakdown) / 100;
  entity.slots = Math.max(0, Math.ceil(Math.max(0, amount - 100) / 100));
  entity.name = isFloorCoinEntity(entity)
    ? `${amount} ${key === "gold" ? "gp" : key === "silver" ? "sp" : "cp"} on floor`
    : `${key === "gold" ? "g.p." : key === "silver" ? "s.p." : "c.p."} pouch`;
  entity.description = isFloorCoinEntity(entity)
    ? `${amount} ${getCoinLabel(key)} on the floor.`
    : `${amount} ${getCoinLabel(key)} in a pouch.`;
  if (amount <= 0) {
    entity.collected = true;
    entity.visible = false;
  }
}

function createFloorCoinEntityFromPouch(loot, key, amount) {
  const coinBreakdown = { gold: 0, silver: 0, copper: 0 };
  coinBreakdown[key] = Math.max(0, Math.floor(Number(amount) || 0));
  const entity = {
    id: `coin-floor-${key}-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
    type: "treasure",
    subtype: `dropped-${key}`,
    kind: "coin-cache",
    name: "",
    x: loot.x,
    y: loot.y,
    routeId: routeOf(state, loot),
    roomId: loot.roomId,
    visible: true,
    revealed: true,
    collected: false,
    value: 0,
    slots: 0,
    bonusSlots: 0,
    priceless: false,
    description: "",
    coinBreakdown
  };
  refreshCoinEntity(entity, key);
  state.entities.push(entity);
  return entity;
}

function moveCoinUnits(source, target, key, amount) {
  const moveAmount = Math.min(getCoinEntityAmount(source, key), Math.max(0, Math.floor(Number(amount) || 0)));
  if (!moveAmount || !source || !target) {
    return 0;
  }
  source.coinBreakdown[key] = getCoinEntityAmount(source, key) - moveAmount;
  target.coinBreakdown = target.coinBreakdown || { gold: 0, silver: 0, copper: 0 };
  target.coinBreakdown[key] = getCoinEntityAmount(target, key) + moveAmount;
  target.collected = false;
  target.visible = true;
  refreshCoinEntity(source, key);
  refreshCoinEntity(target, key);
  return moveAmount;
}

function adjustCoinFeature(loot, direction) {
  if (sendSharedCommand("coin_adjust", { entity_id: loot.id, direction })) return false;
  if (!partyCanReachLoot(state, loot)) { setStatus('Move a party member beside this item.'); return false; }
  const key = getCoinEntityKey(loot);
  const floor = isFloorCoinEntity(loot);
  let counterpart = findCoinCounterpart(loot, key);
  if (!counterpart && ((floor && direction === "down") || (!floor && direction === "up"))) {
    return false;
  }
  if (!counterpart) {
    counterpart = createFloorCoinEntityFromPouch(loot, key, 0);
  }
  const source = (floor && direction === "down") || (!floor && direction === "up") ? loot : counterpart;
  const target = source === loot ? counterpart : loot;
  const moved = moveCoinUnits(source, target, key, 1);
  if (moved) {
    markUserActivity();
    markRunDirty();
    render();
    updatePanels();
  }
  return moved > 0;
}

function setCoinFeatureAmount(loot, nextAmount) {
  if (sendSharedCommand("coin_amount", { entity_id: loot.id, amount: Number(nextAmount) })) return;
  if (!partyCanReachLoot(state, loot)) { setStatus('Move a party member beside this item.'); return; }
  const key = getCoinEntityKey(loot);
  const current = getCoinEntityAmount(loot, key);
  const counterpart = findCoinCounterpart(loot, key);
  const total = current + getCoinEntityAmount(counterpart, key);
  const targetAmount = Math.max(0, Math.min(total, Math.floor(Number(nextAmount) || 0)));
  if (targetAmount === current) {
    return;
  }
  const needsCounterpart = targetAmount < current || counterpart;
  if (!needsCounterpart) {
    return;
  }
  const other = counterpart || createFloorCoinEntityFromPouch(loot, key, 0);
  if (targetAmount > current) {
    moveCoinUnits(other, loot, key, targetAmount - current);
  } else {
    moveCoinUnits(loot, other, key, current - targetAmount);
  }
  markUserActivity();
  markRunDirty();
  render();
  updatePanels();
}

function createCoinFeatureControls(loot) {
  const controls = document.createElement("span");
  controls.className = "coin-feature-controls";
  const up = document.createElement("button");
  up.type = "button";
  up.textContent = "up";
  const down = document.createElement("button");
  down.type = "button";
  down.textContent = "down";
  const amount = document.createElement("input");
  amount.type = "number";
  amount.min = "0";
  amount.step = "1";
  amount.value = `${getCoinEntityAmount(loot)}`;
  amount.title = "Coins in this pile or pouch";
  up.addEventListener("click", (event) => {
    event.stopPropagation();
    adjustCoinFeature(loot, "up");
  });
  down.addEventListener("click", (event) => {
    event.stopPropagation();
    adjustCoinFeature(loot, "down");
  });
  amount.addEventListener("click", (event) => event.stopPropagation());
  amount.addEventListener("change", (event) => {
    event.stopPropagation();
    setCoinFeatureAmount(loot, amount.value);
  });
  controls.append(up, down, amount);
  return controls;
}

function formatRoomLootButtonText(loot) {
  const slotCount = Math.max(1, Number(loot?.slots || 1) || 1);
  const slotText = `${slotCount} slot${slotCount === 1 ? "" : "s"}`;
  if (loot?.coinBreakdown) {
    if (isFloorCoinEntity(loot)) {
      return `${getCoinEntityAmount(loot)} ${getCoinEntityKey(loot) === "gold" ? "gp" : getCoinEntityKey(loot) === "silver" ? "sp" : "cp"} on floor`;
    }
    return `coin pouch (${getCoinEntityCpLabel(loot)})`;
  }
  if (loot?.subtype === "dropped-equipment") {
    return `${loot.name || "equipment"} (${slotText})`;
  }
  return `Get: ${loot?.name || "treasure"} (${slotText})`;
}

function updateRoomLootPanel() {
  ui.roomLootPanel.innerHTML = "";
  ui.roomLootPanel.hidden = false;
  const roomLoot = getRoomLoot(state);
  const treasureLoot = roomLoot.filter((loot) => loot.subtype !== "dropped-equipment");
  const roomFeatures = state.entities.filter((entity) => (
    entity.type === "feature" &&
    sameRoute(state, entity, state.player) &&
    entity.worthlessLoot !== true &&
    entity.subtype !== "room-feature" &&
    entity.subtype !== "door" &&
    entity.visible !== false &&
    partyInLootArea(state, entity) && isFeatureCurrentlyVisible(state, entity)
  ));
  if (roomLoot.length === 0 && roomFeatures.length === 0) {
    ui.roomLootPanel.hidden = true;
    return;
  }

  if (treasureLoot.length > 1) {
    const lootAllButton = document.createElement("button");
    lootAllButton.type = "button";
    lootAllButton.textContent = "Get All";
    lootAllButton.addEventListener("click", () => {
      if (sendSharedCommand("collect")) return;
      const result = collectRoomLoot(state);
      processMonsterVisibilityChange();
      normalizeCharacterState(state);
      syncAllCharacterEquipmentDerivedStats();
      syncPlayerLightFromActiveCharacter();
      markUserActivity();
      setStatus(result.message || result);
      render();
      updatePanels();
      maybeShowFullyLooted();
    });
    ui.roomLootPanel.append(lootAllButton);
  }

  for (const loot of roomLoot) {
    const row = document.createElement("div");
    row.className = ["room-loot-row", loot.coinBreakdown ? "room-loot-row--coins" : ""].filter(Boolean).join(" ");
    const lootButton = document.createElement("button");
    lootButton.type = "button";
    lootButton.disabled = !partyCanReachLoot(state, loot);
    if (lootButton.disabled) lootButton.title = 'Move a party member beside this item to pick it up.';
    const isDroppedEquipment = loot.subtype === "dropped-equipment";
    lootButton.textContent = formatRoomLootButtonText(loot);
    lootButton.addEventListener("click", () => {
      if (isFloatingDisc(getActiveCharacter(state))) { collectForFloatingDisc(loot); return; }
      if (sendSharedCommand("pickup", { entity_id: loot.id })) return;
      const activeCharacter = getActiveCharacter(state);
      const result = isDroppedEquipment
        ? pickupDroppedEquipment(loot)
        : collectLoot(state, loot.id);
      processMonsterVisibilityChange();
      if (result.collected || result.message?.startsWith?.("Got:") || isDroppedEquipment) {
        normalizeCharacterState(state);
        syncAllCharacterEquipmentDerivedStats();
        syncPlayerLightFromActiveCharacter();
        if (activeCharacter) {
          refreshCharacterViews(activeCharacter);
        }
      }
      markUserActivity();
      markRunDirty();
      setStatus(result.message || result);
      render();
      updatePanels();
      maybeShowFullyLooted();
    });
    row.append(lootButton);
    if (loot.coinBreakdown) {
      row.append(createCoinFeatureControls(loot));
    }
    ui.roomLootPanel.append(row);
  }

  for (const feature of roomFeatures) {
    const card = document.createElement("article");
    card.className = "trap-card";
    const title = document.createElement("h3");
    title.textContent = feature.name || "Dungeon feature";
    card.append(title);
    if(feature.characterCorpse) {
      const view=document.createElement('button');view.type='button';view.textContent='View Sheet';
      view.addEventListener('click',()=>openCorpseSheet(feature));card.append(view);
      const permitted=!isSharedRoom()||multiplayerSession.role==='host'||multiplayerSession.options?.bury_others||feature.ownerMemberId===multiplayerSession.current_player_id;
      if(permitted&&!isCombatActive()) {
        const bury=document.createElement('button');bury.type='button';bury.textContent='Bury';
        bury.addEventListener('click',()=>{
          if(isSharedRoom()){void executeSharedCommand({type:'bury_corpse',entity_id:feature.id}).catch(()=>{});return;}
          buryCorpse(feature.id);
        });card.append(bury);
      }
    }
    ui.roomLootPanel.append(card);
  }
}

function createStatRow(term, value, options = {}) {
  const fragment = document.createDocumentFragment();
  const dt = document.createElement("dt");
  dt.textContent = term;
  const dd = document.createElement("dd");
  const displayValue = value || "unknown";
  if (options.damageAware) {
    appendDamageAwareText(dd, displayValue, {
      sourceLabel: options.sourceLabel || term,
      references: options.references
    });
  } else {
    dd.textContent = displayValue;
  }
  fragment.append(dt, dd);
  return fragment;
}

function createMonsterAttackStatRow(monster) {
  const fragment = document.createDocumentFragment();
  const dt = document.createElement("dt");
  dt.textContent = "ATK";
  const dd = document.createElement("dd");
  dd.append(createMonsterAttackContent(monster));
  fragment.append(dt, dd);
  return fragment;
}

function renderMonsterMini(monster) {
  const card = document.createElement('article'); card.className = 'monster-card'; card.dataset.monsterId = monster.id;
  const title = document.createElement('h3'); title.textContent = `${displayMonsterName(monster)} | Level ${monster.level || 1}`;
  const stats = document.createElement('div'); stats.className = 'monster-mini-stats';
  stats.textContent = `AC ${monster.ac} | HP ${monster.hp} | Attacks: ${monster.attack || 'None'}`;
  card.append(title, stats);
  card.title = Object.entries(monster.abilities || {}).map(([name, description]) => `${name}: ${description}`).join('\n');
  if (isSleeping(monster, state)) {
    const wake = document.createElement('button'); wake.type = 'button'; wake.textContent = 'Wake';
    wake.addEventListener('click', () => performWake(getActiveCharacter(state), monster.id)); card.append(wake);
  }
  return card;
}

function openMonsterSheet(monster) {
  const modal = document.createElement('dialog'); modal.className = 'sd-save-menus sd-simple-dialog'; modal.setAttribute('aria-label', displayMonsterName(monster));
  modal.addEventListener('keydown', event => event.stopPropagation());
  const heading = document.createElement('h2'); heading.textContent = displayMonsterName(monster);
  const close = document.createElement('button'); close.textContent = 'X'; close.setAttribute('aria-label', 'Close monster sheet'); close.onclick = () => modal.close();
  const stats = document.createElement('p'); stats.textContent = `Level ${monster.level || 1} | AC ${monster.ac} | HP ${monster.hp}`;
  const languages = document.createElement('p'); languages.textContent = `Languages: ${(monster.languages || []).join(', ') || 'None'}`;
  const traits = document.createElement('div');
  for (const [name, description] of Object.entries(monster.abilities || {})) {
    const line = document.createElement('p'); line.textContent = `${name}: ${description}`; traits.append(line);
  }
  modal.append(heading, close, stats, languages, traits); modal.addEventListener('close', () => modal.remove());
  document.body.append(modal); modal.showModal();
}

function updateMonsterPanel() {
  ui.monsterPanel.innerHTML = "";
  ui.monsterPanel.hidden = false;
  const monsters = state.entities.filter((entity) => {
    return entity.type === "monster" && isMonsterCurrentlyVisible(state, entity) && !concealedMimic(entity);
  });

  if (monsters.length === 0) {
    ui.monsterPanel.hidden = true;
    return;
  }

  for (const monster of monsters) {
    if(isDoppelganger(monster)&&monster.impersonatedCharacter&&!monster.disguiseRevealed) {
      const fake={...monster.impersonatedCharacter,id:monster.id,x:monster.x,y:monster.y};
      const card=renderCharacterCard(fake).cloneNode(true);
      card.removeAttribute('role');card.removeAttribute('tabindex');card.removeAttribute('aria-label');
      for(const control of card.querySelectorAll('button,input,select'))control.remove();
      card.classList.remove('is-combat-inactive');ui.monsterPanel.append(card);continue;
    }
    const card = document.createElement("article");
    card.className = "monster-card";
    card.dataset.monsterId = monster.id;
    const combatEntry = getCurrentCombatEntry();
    card.classList.toggle("is-combat-inactive", Boolean(isCombatActive() && !(combatEntry?.type === "monster" && combatEntry.id === monster.id)));

    const title = document.createElement("h3");
    title.textContent = monster.wandering ? `${displayMonsterName(monster)} (wandering)` : displayMonsterName(monster);
    if (!concealedAnimatedArmor(monster) && !(isDoppelganger(monster) && !monster.disguiseRevealed)) {
      title.tabIndex = 0; title.setAttribute('role', 'button'); title.setAttribute('aria-label', `Open ${displayMonsterName(monster)} sheet`);
      title.onclick = () => openMonsterSheet(monster);
      title.onkeydown = event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); openMonsterSheet(monster); } };
    }
    card.append(title);
    if(concealedAnimatedArmor(monster) || isDoppelganger(monster)&&!monster.disguiseRevealed){ui.monsterPanel.append(card);continue;}

    const stats = document.createElement("dl");
    stats.className = 'monster-mini-stats';
    stats.append(
      createStatRow("AC", monster.ac),
      createMonsterAttackStatRow(monster)
    );
    card.append(stats);

    const hpControls = document.createElement("div");
    hpControls.className = "monster-hp-controls";
    const hpLabel = document.createElement("span");
    hpLabel.textContent = "HP";
    const minusButton = document.createElement("button");
    minusButton.type = "button";
    minusButton.textContent = "-";
    const hpInput = document.createElement("input");
    hpInput.type = "number";
    hpInput.min = "0";
    hpInput.max = "999";
    hpInput.value = `${Math.max(0, Number(monster.hp) || 0)}`;
    hpInput.setAttribute("aria-label", `${monster.name || "Monster"} HP`);
    const plusButton = document.createElement("button");
    plusButton.type = "button";
    plusButton.textContent = "+";
    const applyMonsterHp = (nextHp) => {
      monster.hp = Math.max(0, Math.min(999, Number.parseInt(nextHp, 10) || 0));
      if (monster.hp <= 0) {
        const result = defeatMonster(state, monster);
        const ended = isCombatActive() ? checkCombatEnd() : false;
        if (!ended) {
          setStatus(result.message);
        }
      } else {
        setStatus(`${monster.name || "Monster"} HP set to ${monster.hp}.`);
      }
      markUserActivity();
      markRunDirty();
      render();
      updatePanels();
    };
    minusButton.addEventListener("click", () => applyMonsterHp((Number(monster.hp) || 0) - 1));
    plusButton.addEventListener("click", () => applyMonsterHp((Number(monster.hp) || 0) + 1));
    hpInput.addEventListener("change", () => applyMonsterHp(hpInput.value));
    hpControls.append(hpLabel, minusButton, hpInput, plusButton);
    stats.prepend(hpControls);
    if (isSleeping(monster, state)) {
      const wake = document.createElement('button'); wake.type = 'button'; wake.textContent = 'Wake';
      wake.addEventListener('click', () => performWake(getActiveCharacter(state), monster.id)); stats.append(wake);
    }

    if (monster.attitude === "indifferent" && !isCombatActive()) {
      const attitudeActions = document.createElement("div");
      attitudeActions.className = "monster-attitude-actions";
      if (monsterAllowsDiplomacy(monster)) {
        const persuadeButton = document.createElement("button");
        persuadeButton.type = "button";
        persuadeButton.textContent = "Persuade Monster";
        persuadeButton.addEventListener("click", () => persuadeMonster(monster));
        attitudeActions.append(persuadeButton);
      }
      const attackButton = document.createElement("button");
      attackButton.type = "button";
      attackButton.textContent = "Attack Monster";
      attackButton.addEventListener("click", () => attackIndifferentMonster(monster));
      attitudeActions.append(attackButton);
      card.append(attitudeActions);
    }

    const abilityEntries = Object.entries(monster.abilities || {});
    if (abilityEntries.length) {
      card.title = abilityEntries.map(([name, description]) => `${name.replaceAll('*', '')}: ${description}`).join('\n');
    }

    ui.monsterPanel.append(card);
  }
}

function updateTrapPanel() {
  ui.trapPanel.innerHTML = "";
  ui.trapPanel.hidden = false;
  const traps = getRoomTraps(state);
  if (!state.player.roomId || traps.length === 0) {
    ui.trapPanel.hidden = true;
    return;
  }

  for (const trap of traps) {
    const card = document.createElement("article");
    card.className = "trap-card";

    if (trap.wasSprung) {
      const sprungBanner = document.createElement("div");
      sprungBanner.className = "trap-sprung-banner";
      sprungBanner.textContent = "Trap is Sprung!";
      card.append(sprungBanner);
    }

    const title = document.createElement("h3");
    title.textContent = trap.name;
    card.append(title);

    const stats = document.createElement("dl");
    const stateLabel = trap.disarmed ? "disarmed" : trap.triggered ? "triggered" : "found";
    stats.append(
      createStatRow("Trigger", trap.trigger),
      createStatRow("Effect", trap.effect, {
        damageAware: true,
        sourceLabel: trap.name
      }),
      createStatRow("Trap DC", trap.dc),
      createStatRow("State", stateLabel)
    );
    if(trap.attackDisadvantage)stats.append(createStatRow('Attack','Disadvantage against invisible target'));
    card.append(stats);

    if (!trap.triggered && !trap.disarmed) {
      const disarmButton = document.createElement("button");
      disarmButton.type = "button";
      disarmButton.textContent = "Disarm?";
      disarmButton.addEventListener("click", () => {
        if (sendSharedCommand("disarm", { entity_id: trap.id })) return;
        const context = getCharacterActionContext("disarm");
        const result = disarmTrap(state, trap.id, context.modifier, { doubleRoll: context.doubleRoll });
        const message = createDisarmResultMessage(result);
        markUserActivity();
        setStatus(message);
        showCheckResult(result, "Disarm", {
          headline: `Disarm ${result.total}`,
          message,
          context
        });
        render();
        updatePanels();
      });
      card.append(disarmButton);
    }

    ui.trapPanel.append(card);
  }
}

function updateSelectedPartyControls() {
  const selected = getExplicitActiveCharacter(state);
  const swatch = document.getElementById('selected-character-swatch');
  const name = document.getElementById('selected-character-name');
  const color = selected ? getCharacterColorValue(selected) : '#888';
  if (swatch) swatch.style.backgroundColor = color;
  if (name) name.textContent = selected?.name || 'None';
  const currentTurn = selected && isCombatActive() && isCurrentCharacterTurn(selected);
  const background = selected && isCombatActive() && !currentTurn ? '#d1d1d1' : '#ffffff';
  document.querySelector('.party-selected-row')?.style.setProperty('--selected-character-tint', selected ? mixTokenColor(color, background, currentTurn ? .2 : .1) : '#fff');
}

function updatePanels(options = {}) {
  if (SERVER_RUNTIME) return;
  getTierTwoUi().sync();
  const dialogs = (state.spellDialogMessages || []).filter(message => !seenSpellDialogs.has(message.id));
  if (dialogs.length) { for (const message of dialogs) seenSpellDialogs.add(message.id); showNotice(dialogs.map(message => message.text).join('\n')); }
  document.getElementById('party-heading').textContent = state.partyName || 'The Party';
  if (isSharedRoom()) void getSaveMenus().syncConsensus();
  else if (saveMenus) void saveMenus.syncConsensus();
  const detection = document.getElementById('detect-magic-summary');
  const observer = state.characters.find(character => ownsCharacter(character) && character.focusSpell?.spell === 'detect magic');
  detection.hidden = !observer;
  if (observer) {
    const sensed = state.entities.filter(entity => observer.magicDetectedIds.includes(entity.id));
    detection.textContent = `${observer.name} senses magic: ${sensed.length ? sensed.map(entity =>
      `${displayMonsterName(entity)}${entity.magicPropertiesKnown && entity.gearItem?.magic ? ` (${entity.gearItem.magic.kind})` : ''}`).join(', ') : 'none nearby'}.`;
  }
  if (Array.isArray(state.rollHistory)) { diceHistory = state.rollHistory; renderDiceHistory(); }
  updatePartyAssetsUi();
  updateLootUi();
  if (!options.charactersUnchanged) updateCharactersUi();
  else for (const container of document.querySelectorAll('.pit-mini-actions')) {
    const character = state.characters.find(member => member.id === container.dataset.characterId);
    if (character) updateMiniPitActions(container, character);
  }
  updateLightControlUi();
  updateRoomLootPanel();
  updateMonsterPanel();
  updateTrapPanel();
  updateTrapActionUi();
  updateCombatUi();
  renderMultiplayerUi();
  applyRoomInteractionPermissions();
  syncCriticalSpellDialog();
  updateRestUi();
  syncEncounterPromptUi();
  syncStealUi();
  syncFallingUi();
  syncPitRescueUi();
  syncPitDescentUi();
  syncAdvancementUi();
  syncMishapUi();
  activeShopRefresh?.();
  updateSelectedPartyControls();
  if (!ui.spellcastingModal.hidden) renderSpellcastingMenu({ id: ui.spellcastingModal.dataset.characterId });
  if (!options.charactersUnchanged && !ui.characterSheetModal?.hidden) {
    const character = state.characters.find(item => item.id === ui.characterSheetContent?.dataset.characterId);
    if (character && (ui.characterSheetContent.dataset.interactionKey !== characterSheetInteractionKey(character) || !ui.characterSheetContent.contains(document.activeElement))) renderCharacterDetail(character, ui.characterSheetContent, { popout: true });
  }
}

function maybeShowFullyLooted() {
  if (state.lootLog.fullyLootedShown) {
    return;
  }
  const hasUncollectedTreasure = state.entities.some((entity) => {
    return entity.type === "treasure" && entity.subtype !== "dropped-equipment" && !entity.collected;
  });
  if (!hasUncollectedTreasure) {
    state.lootLog.fullyLootedShown = true;
    ui.lootCompleteModal.hidden = false;
  }
}

function getTileFromPointer(event) {
  const canvas = layers.objectsCanvas;
  const rect = canvas.getBoundingClientRect();
  const rw = rect.width;
  const rh = rect.height;
  if (rw <= 0 || rh <= 0) {
    return { x: 0, y: 0 };
  }
  const px = ((event.clientX - rect.left) / rw) * canvas.width;
  const py = ((event.clientY - rect.top) / rh) * canvas.height;
  return {
    x: Math.floor(px / TILE_SIZE_PX),
    y: Math.floor(py / TILE_SIZE_PX)
  };
}

function normalizeSearchModifier() {
  if (!ui.searchModifierInput) {
    return 0;
  }
  const modifier = Math.max(
    MIN_SEARCH_MODIFIER,
    Math.min(MAX_SEARCH_MODIFIER, Number(ui.searchModifierInput.value || 0))
  );
  ui.searchModifierInput.value = `${modifier}`;
  sizeControlField(ui.searchModifierInput);
  return modifier;
}

function formatRollTooltip(result, action) {
  return `roll ${formatRollText(result)} = ${result.total} for ${action}`;
}

function showCheckResult(result, action = "check", options = {}) {
  if (activeItemCast) activeItemCast.check = result;
  if (SERVER_RUNTIME) {
    lastDamageRoll = { kind: "check", result, actionLabel: action, total: result?.total };
    if (options.recordHistory !== false) {
      const message = options.message || result?.message || formatRollText(result);
      pushDiceHistory(action, message, null, rollTextSegments(message, result));
    }
    return;
  }
  if (!result || !ui.damageResult) {
    return;
  }
  const actionLabel = options.actionLabel || action;
  ui.damageResult.textContent = options.headline || `${actionLabel} ${result.total}`;
  ui.damageContext.textContent = options.message || result.message || actionLabel;
  lastDamageRoll = {
    kind: "check",
    actionLabel,
    result,
    advantageClass: options.context?.doubleRoll ? options.context?.advantageClass : ""
  };
  if (ui.damageExpandBtn) {
    ui.damageExpandBtn.hidden = !Number.isFinite(result.roll) || result.roll <= 0;
  }
  renderDamageDetail(lastDamageRoll);
  if (options.recordHistory !== false) {
    const message = options.message || result.message || formatRollText(result);
    pushDiceHistory(`${actionLabel} ${result.total}`, message, null, rollTextSegments(message, result));
  }
  setDamageDetailVisibility(false);
}

function getCharacterDisplayName(character) {
  return character?.name || "The selected character";
}

function getFoundEntityType(entity) {
  if (!entity) {
    return "nothing";
  }
  if (entity.type === "treasure") {
    return "treasure";
  }
  if (entity.type === "trap") {
    return "trap";
  }
  return entity.type || "something";
}

function createDisarmResultMessage(result) {
  if (result.disarmed) {
    return `Disarm: ${result.total}. You disarm the trap!`;
  }
  if (result.triggered) {
    return `Disarm ${result.total} you have set off the trap!`;
  }
  return `Disarm ${result.total} you fail to disarm the trap, but it doesn't go off.`;
}

function applyTorchAdvance(result) {
  if (result.crossedWanderingChecks) {
    processWanderingChecks(result.crossedWanderingChecks);
  }
  if (result.expired) {
    setStatus(expireActiveLightFromTimer());
  }
}

function processOutOfCombatDyingTick() {
  if (!state || isCombatActive()) {
    lastDyingAutoTickAt = Date.now();
    return false;
  }
  const now = Date.now();
  if (now - lastDyingAutoTickAt < 10000) {
    return false;
  }
  lastDyingAutoTickAt = now;
  const dying = (state.characters || []).filter(isCharacterDying);
  if (!dying.length) {
    return false;
  }
  const messages = [];
  for (const character of dying) {
    const key = `crawl:${Math.floor(now / SPELL_ROUND_MS)}`;
    if (character.reviveTurnKey === key) continue;
    character.reviveTurnKey = key;
    const check = rollCheck(0);
    if (check.roll === 20) { setCharacterHp(character, 1); character.conditions ||= {}; character.conditions.prone = true; }
    else decrementCharacterDyingRounds(character);
    syncCharacterDyingRaw(character);
    const message = check.roll === 20 ? `${character.name} revives with 1 HP!` : character.dead
      ? `${character.name} dies.`
      : `${character.name} is dying in ${character.dyingRounds} ${character.dyingRounds === 1 ? "round" : "rounds"}.`;
    messages.push(message); pushDiceHistory('Revive', message, character.id, rollTextSegments(message, check));
  }
  markRunDirty();
  if (messages.length) setStatus(messages[messages.length - 1]);
  return true;
}

function performSearch() {
  if (sendSharedCommand("search")) return;
  if (!state) {
    return;
  }
  if (!SERVER_RUNTIME && !consumeCharacterCombatAction(getActiveCharacter(state))) return;
  const context = getCharacterActionContext("search");
  const result = searchForTraps(state, context.modifier, { doubleRoll: context.doubleRoll });
  const characterName = getCharacterDisplayName(context.character);
  const foundTypes = [...new Set((result.found || []).map(getFoundEntityType))];
  const foundTypeText = foundTypes.length ? foundTypes.join(" and ") : "nothing";
  const message = result.darknessMessage
    ? result.darknessMessage
    : result.found?.length
      ? `Search ${result.total}. ${characterName} finds ${foundTypeText}!`
      : `Search ${result.total}. ${characterName} finds nothing.`;
  markUserActivity();
  setStatus(message);
  showCheckResult(result, "Search", {
    headline: `Search ${result.total}`,
    message,
    context
  });
  if (hasLiveTimedLight(state) && !result.darknessMessage) {
    applyTorchAdvance(advanceTorchTime(state, TORCH_SEARCH_ADVANCE_MS));
  }
  if (!isCombatActive()) progressWizardEffects(TORCH_SEARCH_ADVANCE_MS, { crawlingTurns: true });
  render();
  updatePanels();
}

function performGet() {
  if (sendSharedCommand("get")) return;
  if (!state) {
    return;
  }
  const [loot] = getRoomLoot(state);
  if (isFloatingDisc(getActiveCharacter(state))) { collectForFloatingDisc(loot); return; }
  const result = loot
    ? loot.subtype === "dropped-equipment"
      ? pickupDroppedEquipment(loot)
      : collectLoot(state, loot.id)
    : { message: "No revealed treasure to get." };
  processMonsterVisibilityChange();
  if (loot && loot.subtype !== "dropped-equipment") {
    normalizeCharacterState(state);
    syncAllCharacterEquipmentDerivedStats();
    syncPlayerLightFromActiveCharacter();
  }
  markUserActivity();
  setStatus(result.message || result);
  render();
  updatePanels();
  maybeShowFullyLooted();
}

function performLeave() {
  if (sendSharedCommand("leave")) return;
  if (!state) {
    return;
  }
  const character = getActiveCharacter(state);
  const treasureIndex = Array.isArray(character?.gear)
    ? character.gear.findIndex((item) => item?.treasureItem === true)
    : -1;
  const gearIndex = treasureIndex >= 0 ? treasureIndex : 0;
  const result = character && gearIndex >= 0 && Array.isArray(character.gear) && character.gear[gearIndex]
    ? dropCharacterGear(character, gearIndex)
    : { message: "No carried treasure to leave." };
  markUserActivity();
  setStatus(result);
  render();
  updatePanels();
}

function performDisarm() {
  if (sendSharedCommand("disarm")) return;
  if (!state) {
    return;
  }
  const [trap] = getRoomTraps(state).filter((candidate) => !candidate.triggered && !candidate.disarmed);
  if (!trap) {
    setStatus("No active revealed trap to disarm.");
    return;
  }
  const context = getCharacterActionContext("disarm");
  const result = disarmTrap(state, trap.id, context.modifier, { doubleRoll: context.doubleRoll });
  const message = createDisarmResultMessage(result);
  markUserActivity();
  setStatus(message);
  showCheckResult(result, "Disarm", {
    headline: `Disarm ${result.total}`,
    message,
    context
  });
  render();
  updatePanels();
}

function sanitizeWanderingInput(input) {
  const value = Math.max(0, Math.min(99, Number.parseInt(input.value || "0", 10) || 0));
  input.value = `${value}`;
  sizeControlField(input);
  normalizeWanderingChance(
    state,
    ui.wanderingNumerator?.value,
    ui.wanderingDenominator?.value
  );
  markUserActivity();
  updateWanderingUi();
}

function formatSavedCharacterName(character) {
  const now = new Date();
  const pad = (value) => String(value).padStart(2, "0");
  const date = `${pad(now.getDate())}/${pad(now.getMonth() + 1)}/${String(now.getFullYear()).slice(-2)}`;
  const time = `${pad(now.getHours())}-${pad(now.getMinutes())}`;
  return `${character?.name || "Character"}_${date}_${time}`;
}

async function saveCharacterSnapshot(character) {
  const currentCharacter = getCurrentCharacter(character);
  if (!currentCharacter) {
    return;
  }
  const saveButton = ui.characterSheetContent?.querySelector(".sd-save-character-button");
  if (saveButton) {
    saveButton.disabled = true;
    saveButton.textContent = "SAVING...";
  }
  try {
    if (!ownsCharacter(currentCharacter)) throw new Error("You can save only your own characters.");
    if (isFloatingDisc(currentCharacter)) throw new Error('Floating Disc is temporary; save the dungeon run instead.');
    const result = isSharedRoom()
      ? await roomRequest(multiplayerSession.id, `characters/${currentCharacter.id}/save`, { name: formatSavedCharacterName(currentCharacter) })
      : await createSavedCharacter(formatSavedCharacterName(currentCharacter), currentCharacter);
    setStatus(`Saved character ${result.name || currentCharacter.name}.`);
  } catch (error) {
    setStatus(error.message);
  } finally {
    if (saveButton) {
      saveButton.disabled = false;
      saveButton.textContent = `SAVE CHARACTER`;
    }
  }
}

async function refreshSavedCharacters() {
  ui.saveLoadStatus.textContent = "Loading saved characters...";
  ui.savedRunsList.innerHTML = "";
  try {
    saveDialog.characters = await listSavedCharacters();
    ui.saveLoadStatus.textContent = saveDialog.characters.length ? "" : "No saved characters yet.";
  } catch (error) {
    saveDialog.characters = [];
    ui.saveLoadStatus.textContent = error.message;
  }
  renderSavedCharactersList();
}

function renderSavedCharactersList() {
  ui.savedRunsList.innerHTML = "";
  for (const character of saveDialog.characters || []) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "saved-run-button";
    const label = document.createElement("span");
    label.textContent = character.name || "Saved character";
    const meta = document.createElement("span");
    meta.className = "saved-run-meta";
    meta.textContent = character.updated_at ? new Date(character.updated_at).toLocaleString() : "";
    button.append(label, meta);
    button.addEventListener("click", () => loadSelectedCharacter(character));
    ui.savedRunsList.append(button);
  }
}

async function loadSelectedCharacter(savedCharacter, { keepOpen = false, throwOnError = false } = {}) {
  ui.saveLoadStatus.textContent = "Loading character...";
  try {
    if (!canUseRoomCharacterImport()) throw new Error("The host is assigning characters for this dungeon.");
    if (!floatingDiscSlotsAvailable(state)) throw new Error("The dungeon already contains 16 characters or reserved spell slots.");
    if (isSharedRoom()) {
      const result = await executeSharedCommand({ type: "import", saved_character_id: savedCharacter.id });
      if (result?.cancelled) throw new Error('The dungeon changed before the character could load.');
      if (!keepOpen) closeSaveLoadModal();
      return;
    }
    const loaded = savedCharacter.character_json ? savedCharacter : await loadSavedCharacter(savedCharacter.id);
    const [character] = extractShadowdarkCharacters(JSON.stringify(loaded.character_json));
    if (!character) {
      throw new Error("Saved character did not include usable character data.");
    }
    const lineage = character.lineageId || loaded.lineageId || character.id;
    if (state.characters.some(member => (member.lineageId || member.id) === lineage)) throw new Error('That character is already in The Party.');
    character.lineageId = lineage;
    character.id = `character-${crypto.randomUUID()}`;
    Object.assign(character.raw, { id: character.id, lineageId: lineage });
    if (Number(character.partyAssetShareCopper || 0) > 0) {
      addPartyAssetsCopper(character.partyAssetShareCopper);
      character.partyAssetShareCopper = 0;
      character.raw = character.raw || {};
      character.raw.partyAssetShareCopper = 0;
    }
    const previousActiveCharacterId = state.activeCharacterId;
    placeCharactersNearStartingStairs([character]);
    state.characters.push(character);
    initializeImportedCharacterLight(character);
    putCharacterFirst(character.id);
    if (!isCombatActive()) {
      state.activeCharacterId = character.id;
    } else {
      state.activeCharacterId = previousActiveCharacterId;
      queueCharactersForNextCombatRound([character]);
    }
    normalizeCharacterState(state);
    applyCharacterAmmoOverrides();
    syncAllCharacterEquipmentDerivedStats();
    applyCharacterColorOverrides();
    ensureCharacterPresentation();
    syncPlayerLightFromActiveCharacter();
    recomputeVisibility(state);
    const sighting = processMonsterVisibilityChange();
    markUserActivity();
    updateCharactersUi();
    render();
    updatePanels();
    if (!keepOpen) closeSaveLoadModal();
    if (!sighting?.combatStarted && !sighting?.combatEnded) {
      setStatus(`Loaded character ${character.name || "saved character"}.`);
    }
  } catch (error) {
    ui.saveLoadStatus.textContent = error.message;
    if (throwOnError) throw error;
  }
}

async function refreshSavedRuns() {
  ui.saveLoadStatus.textContent = "Loading saves...";
  ui.savedRunsList.innerHTML = "";
  try {
    saveDialog.runs = await listRunsWithNames();
    if (saveDialog.mode !== "save") {
      const joined = await listJoinedRooms();
      const roomRuns = joined.results || [];
      const roomSaveIds = new Set(roomRuns.map((room) => room.saved_run_id));
      saveDialog.runs = [
        ...roomRuns.map((room) => ({ ...room, room_id: room.id })),
        ...saveDialog.runs.filter((run) => !roomSaveIds.has(run.id))
      ];
    }
    ui.saveLoadStatus.textContent = saveDialog.runs.length ? "" : "No saved runs yet.";
  } catch (error) {
    saveDialog.runs = [];
    ui.saveLoadStatus.textContent = error.message;
  }
  renderSavedRunsList();
}

function renderSavedRunsList() {
  ui.savedRunsList.innerHTML = "";
  for (const run of saveDialog.runs) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "saved-run-button";
    const label = document.createElement("span");
    label.textContent = run.name || `Level ${run.level} - Seed ${run.seed}`;
    const meta = document.createElement("span");
    meta.className = "saved-run-meta";
    meta.textContent = run.room_id ? (run.role === "host" ? "Hosted dungeon" : "Joined host's dungeon") : `L${run.level} seed ${run.seed}`;
    button.append(label, meta);
    button.addEventListener("click", () => {
      if (saveDialog.mode === "save") {
        saveDialog.pendingRun = run;
        ui.saveNameInput.value = normalizeSaveName(run.name);
        ui.overwriteConfirmation.hidden = false;
        ui.replaceConfirmation.hidden = true;
      } else if (state.run?.hasUserActivity) {
        saveDialog.pendingRun = run;
        ui.replaceConfirmation.hidden = false;
      } else {
        loadSelectedRun(run);
      }
    });
    ui.savedRunsList.append(button);
  }
}

async function openSaveLoadModal(mode) {
  if (mode === "save" && isSharedRoom() && multiplayerSession.role !== "host") return;
  if (mode === "load-character" && !canUseRoomCharacterImport()) {
    setStatus("The host is assigning characters for this dungeon.");
    return;
  }
  if (mode === 'load-character') { await getSaveMenus().openLoadCharacters(); return; }
  saveDialog = {
    mode,
    runs: [],
    characters: [],
    pendingRun: null
  };
  ui.saveLoadTitle.textContent = mode === "save"
    ? "Save Run"
    : mode === "load-character"
      ? "Load Character"
      : "Load Run";
  ui.saveNameRow.hidden = mode !== "save";
  ui.saveModalSubmit.hidden = mode !== "save";
  ui.saveNameInput.value = normalizeSaveName(state.run?.name || "");
  ui.overwriteConfirmation.hidden = true;
  ui.replaceConfirmation.hidden = true;
  ui.saveLoadModal.hidden = false;
  if (mode === "load-character") {
    await refreshSavedCharacters();
  } else {
    await refreshSavedRuns();
  }
}

function closeSaveLoadModal() {
  ui.saveLoadModal.hidden = true;
  saveDialog.pendingRun = null;
}

function findRunByName(name) {
  const normalized = normalizeSaveName(name).toLowerCase();
  return saveDialog.runs.find((run) => normalizeSaveName(run.name).toLowerCase() === normalized) || null;
}

async function saveCurrentRun(overwriteRun = null) {
  const name = normalizeSaveName(ui.saveNameInput.value);
  if (!name) {
    ui.saveLoadStatus.textContent = "Enter a save name.";
    return;
  }
  if (isSharedRoom()) {
    try {
      const saved = await requestRoomHostChange("save", { name });
      applyMultiplayerSessionState(saved);
      ui.saveLoadStatus.textContent = "Dungeon saved.";
    } catch (error) { ui.saveLoadStatus.textContent = error.message; }
    return;
  }
  const duplicate = overwriteRun || findRunByName(name);
  if (!overwriteRun && duplicate) {
    saveDialog.pendingRun = duplicate;
    ui.overwriteConfirmation.hidden = false;
    return;
  }
  if (!overwriteRun && saveDialog.runs.length >= 10) {
    ui.saveLoadStatus.textContent = "Maximum of 10 saved runs reached. Pick an existing save to overwrite.";
    return;
  }

  ui.saveLoadStatus.textContent = "Saving...";
  try {
    const result = duplicate
      ? await updateRun(duplicate.id, name, state, duplicate.revision)
      : await createRun(name, state);
    state.run.id = result.id || duplicate?.id || state.run.id;
    state.run.revision = result.revision;
    state.run.name = name;
    state.run.dirty = false;
    state.run.lastSavedAt = result.updated_at || result.created_at || new Date().toISOString();
    ui.saveLoadStatus.textContent = "Saved.";
    await refreshSavedRuns();
  } catch (error) {
    ui.saveLoadStatus.textContent = error.message;
  }
}

async function loadSelectedRun(run) {
  ui.saveLoadStatus.textContent = "Loading...";
  try {
    if (run.room_id) {
      if (isSharedRoom() && multiplayerSession.id !== run.room_id) await leaveSharedRoom();
      applyMultiplayerSessionState(await roomRequest(run.room_id, "resume", {}));
      closeSaveLoadModal();
      return;
    }
    if (isSharedRoom()) await leaveSharedRoom();
    const loaded = await (run.state_json ? Promise.resolve(run) : loadRun(run.id));
    state = hydrateDungeonState(loaded.state_json);
    restoreMonsterSpellStats(state,shadowdarkContent?.monsters);
    state.run.id = loaded.id;
    state.run.name = normalizeSaveName(loaded.name || state.run.name);
    state.run.dirty = false;
    state.run.hasUserActivity = false;
    ensureCombatState();
    recomputeVisibility(state);
    const sighting = processMonsterVisibilityChange();
    setupCanvasLayers(state);
    updatePanels();
    updateWanderingUi();
    render();
    closeSaveLoadModal();
    if (!sighting?.combatStarted && !sighting?.combatEnded) {
      setStatus(`Loaded ${state.run.name || "saved run"}.`);
    }
  } catch (error) {
    ui.saveLoadStatus.textContent = error.message;
  }
}

function isSharedRoom() {
  return !SERVER_RUNTIME && Boolean(multiplayerSession.id);
}

function ownsCharacter(character) {
  return !isSharedRoom() || multiplayerSession.owned_character_ids?.includes(character?.id);
}

function canControlCharacter(character) {
  return Boolean(character) && ownsCharacter(character) && (!isSharedRoom() || multiplayerSession.can_explore) &&
    !restInProgress(state) &&
    (!isCombatActive() || isCurrentCharacterTurn(character));
}

function isPendingLightRequestCurrent() {
  return pendingLightRequest?.characterId === state.activeCharacterId && (!isCombatActive() ||
    (pendingLightRequest.round === state.combat.round && pendingLightRequest.turnIndex === state.combat.turnIndex));
}

function canBuryCharacter(character) {
  return !isSharedRoom() || (multiplayerSession.can_explore &&
    (ownsCharacter(character) || multiplayerSession.role === "host" || multiplayerSession.options?.bury_others));
}

function canUseRoomCharacterImport() {
  if (!isSharedRoom() || multiplayerSession.role === "host") return true;
  if (!multiplayerSession.options?.players_can_import) return false;
  return multiplayerSession.options?.extra_characters_without_host === true ||
    !state.characters.some(character => !isFloatingDisc(character) && ownsCharacter(character));
}

function applyRoomInteractionPermissions() {
  if (!state) return;
  const active = getExplicitActiveCharacter(state);
  const blocked = !active || !canControlCharacter(active) || (isCombatActive() && !isCurrentCharacterTurn(active));
  for (const control of [ui.lightTorchBtn, ui.lightLanternBtn, ui.castLightBtn, ui.torchOutBtn, ui.searchBtn,
    ui.stealthBtn, ui.pickLockBtn, ui.breakDoorBtn, ui.endTurnBtn]) {
    if (control) control.disabled = blocked || isFloatingDisc(active) && control !== ui.lightLanternBtn || (isCombatActive() && state.combat.actionUsed && control !== ui.endTurnBtn);
  }
  for (const root of [ui.roomLootPanel, ui.monsterPanel, ui.trapPanel, ui.combatPanel]) {
    if (blocked || isFloatingDisc(active) && root !== ui.roomLootPanel || (isCombatActive() && state.combat.actionUsed)) {
      for (const control of root?.querySelectorAll("button, input, select, textarea") || []) control.disabled = true;
    }
  }
}

function roomOrderKey() {
  return `sd-character-order:${multiplayerSession.id || "solo"}:${multiplayerSession.current_player_id || "local"}`;
}

function localCharacterOrder() {
  try { return JSON.parse(localStorage.getItem(roomOrderKey()) || "[]"); } catch { return []; }
}

function currentRestMarchingOrder() {
  const livingIds = state.characters.filter(character => !isFloatingDisc(character) && !isCharacterDead(character)).map(character => character.id);
  const preferred = localCharacterOrder();
  return [...new Set([...preferred.filter(id => livingIds.includes(id)), ...livingIds])];
}

function putCharacterFirst(id) {
  if (SERVER_RUNTIME) return;
  const order = [id, ...localCharacterOrder().filter((item) => item !== id)];
  localStorage.setItem(roomOrderKey(), JSON.stringify(order));
}

function reorderLocalCharacter(source, destination, after = false) {
  if (!destination || source === destination) return;
  const ids = [...ui.charactersList.children].map((item) => item.dataset.characterId).filter((id) => id !== source);
  if (!ids.includes(destination)) return;
  ids.splice(ids.indexOf(destination) + (after ? 1 : 0), 0, source);
  localStorage.setItem(roomOrderKey(), JSON.stringify(ids));
  updateCharactersUi();
}

function localFollowIds() {
  if (SERVER_RUNTIME) return [];
  try { return JSON.parse(localStorage.getItem(`${roomOrderKey()}:follow`) || '[]'); } catch { return []; }
}

function toggleCharacterFollow(id) {
  const ids = new Set(localFollowIds());
  if (ids.has(id)) ids.delete(id); else ids.add(id);
  localStorage.setItem(`${roomOrderKey()}:follow`, JSON.stringify([...ids]));
  updateCharactersUi();
}

function currentMarchingCommand() {
  const owned = state.characters.filter(character => !isFloatingDisc(character) && ownsCharacter(character)).map(character => character.id);
  const preferred = localCharacterOrder();
  const order = [...preferred.filter(id => owned.includes(id)), ...owned.filter(id => !preferred.includes(id))];
  return { marching_order: order, following_ids: localFollowIds().filter(id => owned.includes(id)) };
}

function advanceMarchingOrder(anchor, delta = null, command = null, options = {}) {
  if (!anchor || isCombatActive()) return false;
  const values = command || currentMarchingCommand();
  if (!values.following_ids?.length) return false;
  const groupId = SERVER_RUNTIME ? values.follow_group_id || 'solo' : multiplayerSession.current_player_id || 'solo';
  state.marchingGroups ||= {};
  const previous = state.marchingGroups[groupId];
  const group = previous?.anchorId === anchor.id ? previous : { anchorId: anchor.id, direction: [0, 1], trail: [] };
  if (delta) {
    group.direction = delta;
    group.trail.unshift({ x: Number(anchor.x), y: Number(anchor.y), routeId: routeOf(state, anchor) });
    if (group.trail.length === 1) group.trail.push({ x: Number(anchor.x) - delta[0], y: Number(anchor.y) - delta[1], routeId: routeOf(state, anchor) });
    group.trail = group.trail.slice(0, 40);
  }
  state.marchingGroups[groupId] = group;
  const steps = planMarchingSteps(state, anchor.id, { order: values.marching_order, followingIds: values.following_ids, ...group }, {
    canStep: (x, y, nextX, nextY, point) => canMoveBetweenTiles(state, x, y, nextX, nextY, { routeId: point?.routeId }).ok,
    isLit: (x, y) => isTileVisible(state, x, y)
  });
  if (options.previewOnly) return steps.length > 0;
  if (SERVER_RUNTIME && command?.type === 'follow_step') {
    if (Date.now() - (group.lastFollowAt || 0) < 900) return false;
    group.lastFollowAt = Date.now();
  }
  let changed = false;
  for (const step of steps) {
    if (isCombatActive()) break;
    const character = state.characters.find(item => item.id === step.characterId);
    if (!SERVER_RUNTIME && !canControlCharacter(character)) continue;
    if (!SERVER_RUNTIME && localWaterMotions.has(character.id)) continue;
    const before = { x: Number(character.x), y: Number(character.y), roomId: character.roomId, routeId: routeOf(state, character) };
    setActiveCharacter(state, character.id);
    syncPlayerToActiveCharacter();
    const result = movePlayer(state, step.dx, step.dy, { deferVisibility: true });
    if (!result.moved) continue;
    changed = true;
    syncActiveCharacterToPlayer();
    if (!SERVER_RUNTIME && movementStepCost(state,before.x,before.y,character)>1) animateLocalWaterStep(character,before);
    recomputeVisibility(state);
    processMonsterVisibilityChange();
    if (SERVER_RUNTIME && values.motion_id) {
      const frames = serverFollowerFrames.get(character.id) || [before];
      frames.push({ x: character.x, y: character.y, roomId: character.roomId, routeId: routeOf(state, character) });
      serverFollowerFrames.set(character.id, frames);
    }
  }
  if (!isCombatActive()) setActiveCharacter(state, anchor.id);
  syncPlayerToActiveCharacter();
  if (changed) { recomputeVisibility(state); markRunDirty(); }
  return changed;
}

let sharedCommandQueue = Promise.resolve();
let sharedCommandPending = 0;
let sharedCommandGeneration = 0;
let applyingSharedState = false;
const sharedEditTimers = new Map();
const pendingSharedMoves = [];
const sharedMoveBuffer = [];
const SHARED_MOVE_BATCH_SIZE = 8;
const MAX_PENDING_SHARED_MOVES = 32;
const SHARED_MOVE_FLUSH_DELAY_MS = 35;
const SHARED_MOVE_MIN_INTERVAL_MS = 200;
let sharedMoveFlushTimer = null;
let sharedMoveBatchesOutstanding = 0;
let lastSharedMoveBatchAt = 0;
let sharedMotionGeneration = 0;
const seenSharedMotionIds = new Set();
const sharedCharacterVisualPositions = new Map();
const localWaterMotions = new Map();
const sharedMotionQueues = new Map();

function createSharedViewerVisibility(base, saved = {}) {
  const closedDoorExploredSides = new Map(Object.entries(saved.closedDoorExploredSides || {}).map(
    ([doorId, sides]) => [doorId, new Set(Array.isArray(sides) ? sides : [])]
  ));
  const routeDarkvisionExplored = Object.fromEntries(Object.entries(saved.routeDarkvisionExplored || {}).map(
    ([route, cells]) => [route, new Set(Array.from(cells instanceof Set || Array.isArray(cells) ? cells : [])
      .filter(key => typeof key === 'string' && /^\d+,\d+$/.test(key)))]
  ));
  return {
    ...(base || {}),
    visibleNow: new Set(),
    routeVisible: {},
    darkvisionNow: new Set(),
    routeDarkvision: {},
    routeDarkvisionExplored,
    darkvisionExplored: new Set(Object.values(routeDarkvisionExplored).flatMap(cells => [...cells])),
    routeExplored: Object.fromEntries(Object.entries(saved.routeExplored || {}).map(([id, cells]) => [id, new Set(cells)])),
    exploredEver: new Set(Array.isArray(saved.exploredEver) ? saved.exploredEver : []),
    exploredBeforeNow: new Set(Array.isArray(saved.exploredEver) ? saved.exploredEver : []),
    exploredLightPolygons: [],
    exploredLightPolygonsBeforeNow: [],
    exploredLightPolygonKeys: new Set(),
    visitedRoomIds: new Set(Array.isArray(saved.visitedRoomIds) ? saved.visitedRoomIds : []),
    exploredInnerWallInteriors: new Set(
      Array.isArray(saved.exploredInnerWallInteriors) ? saved.exploredInnerWallInteriors : []
    ),
    closedDoorVisibleSides: new Map(),
    closedDoorExploredSides
  };
}

function attachSharedViewerScope(currentState, characterIds) {
  Object.defineProperty(currentState, "viewerCharacterIds", {
    configurable: true,
    writable: true,
    value: new Set(characterIds || [])
  });
}

function serializeSharedViewerVisibility() {
  const visibility = state?.visibility;
  if (!visibility) return {};
  return {
    exploredEver: Array.from(visibility.exploredEver || []),
    routeExplored: Object.fromEntries(Object.entries(visibility.routeExplored || {}).map(([id, cells]) => [id, [...cells]])),
    routeDarkvisionExplored: Object.fromEntries(Object.entries(visibility.routeDarkvisionExplored || {}).map(([id, cells]) =>
      [id, Array.from(cells instanceof Set || Array.isArray(cells) ? cells : []).filter(key => typeof key === 'string' && /^\d+,\d+$/.test(key))])),
    visitedRoomIds: Array.from(visibility.visitedRoomIds || []),
    exploredInnerWallInteriors: Array.from(visibility.exploredInnerWallInteriors || []),
    closedDoorExploredSides: Object.fromEntries(
      [...(visibility.closedDoorExploredSides || new Map()).entries()].map(([doorId, sides]) => [
        doorId,
        Array.from(sides || [])
      ])
    )
  };
}

function rememberSharedMotionId(id) {
  seenSharedMotionIds.add(id);
  while (seenSharedMotionIds.size > 80) {
    seenSharedMotionIds.delete(seenSharedMotionIds.values().next().value);
  }
}

function resetSharedMotionPlayback(motions = []) {
  sharedMotionGeneration += 1;
  localWaterMotions.clear();
  seenSharedMotionIds.clear();
  for (const motion of motions) rememberSharedMotionId(motion.id);
  for (const character of state?.characters || []) {
    delete character.visualX;
    delete character.visualY;
  }
  sharedCharacterVisualPositions.clear();
  sharedMotionQueues.clear();
}

function displayedCharacterPositions() {
  return new Map((state?.characters || []).map((character) => {
    const visual = sharedCharacterVisualPositions.get(character.id);
    return [character.id, visual || {
      x: Number(character.visualX ?? character.x),
      y: Number(character.visualY ?? character.y)
    }];
  }));
}

function setSharedCharacterVisualPosition(characterId, position) {
  const x = Number(position?.x);
  const y = Number(position?.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return;
  sharedCharacterVisualPositions.set(characterId, { x, y, routeId: position.routeId });
  const character = state?.characters?.find((item) => item.id === characterId);
  if (!character) return;
  Object.defineProperty(character, "visualX", { configurable: true, writable: true, value: x });
  Object.defineProperty(character, "visualY", { configurable: true, writable: true, value: y });
  Object.defineProperty(character, 'visualRouteId', { configurable: true, writable: true, value: position.routeId ?? routeOf(state, character) });
}

function applySharedCharacterVisualPositions() {
  for (const [characterId, position] of sharedCharacterVisualPositions) {
    setSharedCharacterVisualPosition(characterId, position);
  }
}

function clearSharedCharacterVisualPosition(characterId) {
  sharedCharacterVisualPositions.delete(characterId);
  const character = state?.characters?.find((item) => item.id === characterId);
  if (!character) return;
  delete character.visualX;
  delete character.visualY;
  delete character.visualRouteId;
}

function nextAnimationFrame() {
  return new Promise((resolve) => requestAnimationFrame(resolve));
}

function animateLocalWaterStep(character, origin) {
  const initialState = state, roomId = multiplayerSession?.id;
  const destination = { x: Number(character.x), y: Number(character.y) };
  const startedAt = performance.now();
  const marker = {};
  localWaterMotions.set(character.id, marker);
  setSharedCharacterVisualPosition(character.id, origin);
  void (async () => {
    let lastVisibilityAt = 0;
    try {
      while (localWaterMotions.get(character.id) === marker) {
        const now = await nextAnimationFrame();
        if ((roomId ? multiplayerSession?.id !== roomId : state !== initialState) ||
            !state.characters.some(member => member.id === character.id)) break;
        const progress = Math.min(1, (now - startedAt) / WATER_STEP_DURATION_MS);
        setSharedCharacterVisualPosition(character.id, {
          x: origin.x + (destination.x - origin.x) * progress,
          y: origin.y + (destination.y - origin.y) * progress
        });
        if (now - lastVisibilityAt >= 50 || progress === 1) { recomputeVisibility(state); lastVisibilityAt = now; }
        render({ motionOnly: true });
        if (progress === 1) break;
      }
    } finally {
      if (localWaterMotions.get(character.id) === marker) {
        localWaterMotions.delete(character.id);
        clearSharedCharacterVisualPosition(character.id);
        if (state === initialState || (roomId && multiplayerSession?.id === roomId)) {
          recomputeVisibility(state); render({ motionOnly: true });
        }
      }
    }
  })();
}

async function animateSharedMotion(motion, generation) {
  const frames = motion.frames || [];
  if (frames.length < 2) return;
  const characterId = motion.characterId;
  let current = sharedCharacterVisualPositions.get(characterId) || frames[0];
  const destinations = [];
  if (Number(current.x) !== Number(frames[0].x) || Number(current.y) !== Number(frames[0].y)) {
    destinations.push(frames[0]);
  }
  destinations.push(...frames.slice(1));
  const stepDurationMs = Math.max(28, Math.min(100, 220 / Math.max(1, destinations.length)));
  for (const destination of destinations) {
    const start = sharedCharacterVisualPositions.get(characterId) || current;
    const duration = movementStepCost(state, Math.round(start.x), Math.round(start.y)) > 1 ? WATER_STEP_DURATION_MS : stepDurationMs;
    const startedAt = performance.now();
    while (true) {
      const now = await nextAnimationFrame();
      if (generation !== sharedMotionGeneration || !isSharedRoom()) return;
      const progress = Math.min(1, (now - startedAt) / duration);
      const eased = progress * (2 - progress);
      setSharedCharacterVisualPosition(characterId, {
        x: Number(start.x) + (Number(destination.x) - Number(start.x)) * eased,
        y: Number(start.y) + (Number(destination.y) - Number(start.y)) * eased,
        routeId: eased < .5 ? start.routeId : destination.routeId
      });
      if (progress >= 1) recomputeVisibility(state);
      render({ motionOnly: true });
      if (progress >= 1) break;
    }
    current = destination;
  }
}

function queueSharedMotionAnimation(motion) {
  const characterId = motion.characterId;
  const generation = sharedMotionGeneration;
  const previous = sharedMotionQueues.get(characterId) || Promise.resolve();
  const task = previous.catch(() => {}).then(() => animateSharedMotion(motion, generation));
  sharedMotionQueues.set(characterId, task);
  void task.then(() => {
    if (sharedMotionQueues.get(characterId) !== task) return;
    sharedMotionQueues.delete(characterId);
    if (generation !== sharedMotionGeneration) return;
    clearSharedCharacterVisualPosition(characterId);
    if (state && isSharedRoom()) {
      recomputeVisibility(state);
      render({ motionOnly: true });
    }
  });
}

function removePendingSharedMoves(ids) {
  if (!ids?.length) return;
  const removed = new Set(ids);
  for (let index = pendingSharedMoves.length - 1; index >= 0; index -= 1) {
    if (removed.has(pendingSharedMoves[index].id)) pendingSharedMoves.splice(index, 1);
  }
}

function replayPendingSharedMoves() {
  if (!state || !pendingSharedMoves.length) return;
  const selectedId = state.activeCharacterId;
  for (const move of pendingSharedMoves) {
    const character = state.characters.find((item) => item.id === move.characterId);
    if (!character || !ownsCharacter(character)) continue;
    setActiveCharacter(state, character.id);
    syncPlayerToActiveCharacter();
    applyLocalMovement([move.dx, move.dy], { render: false });
  }
  const selected = state.characters.find((item) => item.id === selectedId);
  const fallback = state.characters.find((item) => ownsCharacter(item));
  if (selected || fallback) setActiveCharacter(state, (selected || fallback).id);
  syncPlayerToActiveCharacter();
  recomputeVisibility(state);
}

function scheduleSharedMoveFlush() {
  if (sharedMoveFlushTimer || !sharedMoveBuffer.length || sharedMoveBatchesOutstanding) return;
  const elapsed = Date.now() - lastSharedMoveBatchAt;
  const delayMs = Math.max(SHARED_MOVE_FLUSH_DELAY_MS, SHARED_MOVE_MIN_INTERVAL_MS - elapsed);
  sharedMoveFlushTimer = setTimeout(() => {
    sharedMoveFlushTimer = null;
    flushSharedMoveBuffer();
  }, delayMs);
}

function flushSharedMoveBuffer(forceAll = false) {
  if (sharedMoveFlushTimer) clearTimeout(sharedMoveFlushTimer);
  sharedMoveFlushTimer = null;
  if (!sharedMoveBuffer.length || (sharedMoveBatchesOutstanding && !forceAll)) return;
  do {
    const first = sharedMoveBuffer[0];
    const batch = [];
    while (sharedMoveBuffer.length && batch.length < SHARED_MOVE_BATCH_SIZE &&
        sharedMoveBuffer[0].characterId === first.characterId) {
      batch.push(sharedMoveBuffer.shift());
    }
    lastSharedMoveBatchAt = Date.now();
    sharedMoveBatchesOutstanding += 1;
    void executeSharedCommand({
      type: "move_batch",
      character_id: first.characterId,
      ...currentMarchingCommand(),
      moves: batch.map(({ dx, dy }) => ({ dx, dy }))
    }, null, { optimisticMoveIds: batch.map((move) => move.id) })
      .catch(() => {})
      .finally(() => {
        sharedMoveBatchesOutstanding = Math.max(0, sharedMoveBatchesOutstanding - 1);
        scheduleSharedMoveFlush();
      });
  } while (forceAll && sharedMoveBuffer.length);
}

function queueSharedMove(values, character) {
  if (localWaterMotions.has(character.id)) return;
  if (pendingSharedMoves.length >= MAX_PENDING_SHARED_MOVES) {
    setStatus("Movement is catching up with the dungeon server.");
    return;
  }
  const move = {
    id: crypto.randomUUID(),
    characterId: character.id,
    dx: values.dx,
    dy: values.dy
  };
  pendingSharedMoves.push(move);
  sharedMoveBuffer.push(move);
  applyLocalMovement([move.dx, move.dy]);
  scheduleSharedMoveFlush();
}

async function executeSharedCommand(command, expectedRevision = null, options = {}) {
  const id = multiplayerSession.id;
  const generation = sharedCommandGeneration;
  const optimisticMoveIds = options.optimisticMoveIds || [];
  const requestId = crypto.randomUUID();
  sharedCommandPending += 1;
  const task = sharedCommandQueue.then(async () => {
    if (generation !== sharedCommandGeneration || multiplayerSession.id !== id) return { cancelled: true };
    try {
      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          const result = await roomRequest(id, "commands", {
            revision: expectedRevision ?? multiplayerSession.revision, request_id: requestId, command
          });
          if (generation !== sharedCommandGeneration || multiplayerSession.id !== id) return { cancelled: true };
          removePendingSharedMoves(optimisticMoveIds);
          applyMultiplayerSessionState(result, { message: result.message });
          if (command.type === 'rest_alarm') { ui.spellDetailModal.hidden = true; ui.characterSheetModal.hidden = true; document.getElementById('rest-modal').hidden = false; }
          if (command.type === 'learn_scroll') showNotice(result.message);
          if(command.type==='attack_treasure'&&result.message==='That does nothing.')document.getElementById('treasure-attack-modal').hidden=false;
          if (result.dice?.kind === "check") showCheckResult(result.dice.result, result.dice.actionLabel, { message: result.message, recordHistory: false });
          else if (result.dice) applyDamageResultToPanel(result.dice, result.message, { recordHistory: false });
          return result;
        } catch (error) {
          if (error.status === 409 && attempt === 0 && command.type !== "edit_character") {
            applyMultiplayerSessionState(await getHostSession(id));
            continue;
          }
          throw error;
        }
      }
    } catch (error) {
      removePendingSharedMoves(optimisticMoveIds);
      if (generation === sharedCommandGeneration && multiplayerSession.id === id) {
        applyMultiplayerSessionState(await getHostSession(id).catch(() => multiplayerSession));
      }
      throw error;
    }
  });
  sharedCommandQueue = task.catch((error) => {
    if (error.code !== "request_cancelled") setStatus(error.message);
  }).finally(() => {
    sharedCommandPending = Math.max(0, sharedCommandPending - 1);
    syncCriticalSpellDialog(); updateRestUi();
  });
  return task;
}

function sendSharedCommand(type, values = {}, character = getActiveCharacter(state)) {
  if (!isSharedRoom() || applyingSharedState) return false;
  const restAlarm = type === 'rest_alarm' && state.rest?.phase !== 'sleeping' && !isCombatActive();
  if (restInProgress(state) && !restAlarm) { setStatus('Cancel rest before taking an action.'); return true; }
  if (!pendingSpellAllowsCommand(inventoryController(character), type, values.spell_name)) {
    setStatus(pendingSpellMessage(inventoryController(character)));
    return true;
  }
  if (type === "roll" && !ownsCharacter(character)) return false;
  if (!(type === "bury" ? canBuryCharacter(character) : restAlarm || type === 'luck' ? ownsCharacter(character) && multiplayerSession.can_explore : canControlCharacter(character))) {
    setStatus(!ownsCharacter(character) ? "Choose one of your own characters." : "The dungeon is paused while the host is away.");
    return true;
  }
  if (type === "move") {
    if (isTied(character)) { setStatus('Escape or break the rope before moving.'); return true; }
    if (offerGrapplingEscape(character, [values.dx, values.dy])) return true;
    queueSharedMove(values, character);
    return true;
  }
  flushSharedMoveBuffer(true);
  if (type === "edit_character") {
    clearTimeout(sharedEditTimers.get(character.id));
    const revision = multiplayerSession.revision;
    sharedEditTimers.set(character.id, setTimeout(() => {
      sharedEditTimers.delete(character.id);
      void executeSharedCommand({ type, character_id: character.id, ...values }, revision).catch((error) => setStatus(error.message));
    }, 350));
    return true;
  }
  void executeSharedCommand({ type, character_id: character?.id, ...values }).catch((error) => setStatus(error.message));
  return true;
}

function getCharacterNameById(characterId) {
  return state?.characters?.find((character) => character.id === characterId)?.name || "";
}

function redrawFromHydratedState(message = "") {
  if (!state) return;
  if (!layers || viewport.width !== state.map.width * TILE_SIZE_PX || viewport.height !== state.map.height * TILE_SIZE_PX) setupCanvasLayers(state);
  updateCharactersUi();
  updatePanels();
  updateWanderingUi();
  render();
  if (message) setStatus(message);
}

function queueMonsterTurnPresentations(events, roomChanged) {
  if (SERVER_RUNTIME) return;
  if (roomChanged) {
    sharedMonsterPresentationQueue.length = 0; sharedMonsterPresentation = null; seenMonsterTurnEvents.clear();
    for (const event of events) seenMonsterTurnEvents.add(event.sequence);
    return;
  }
  for (const event of events) {
    if (seenMonsterTurnEvents.has(event.sequence)) continue;
    seenMonsterTurnEvents.add(event.sequence);
    sharedMonsterPresentationQueue.push(event);
  }
  while (seenMonsterTurnEvents.size > 100) seenMonsterTurnEvents.delete(seenMonsterTurnEvents.values().next().value);
  if (sharedMonsterPresentationRunning || !sharedMonsterPresentationQueue.length) return;
  sharedMonsterPresentationRunning = true;
  const roomId = multiplayerSession.id;
  void (async () => {
    try {
      while (sharedMonsterPresentationQueue.length && multiplayerSession.id === roomId) {
        sharedMonsterPresentation = sharedMonsterPresentationQueue.shift();
        syncTurnCard(); render();
        await delay(500);
      }
    } finally {
      sharedMonsterPresentation = null; sharedMonsterPresentationRunning = false;
      syncTurnCard(); render();
    }
  })();
}

function applyMultiplayerSessionState(payload, options = {}) {
  if (payload.id && multiplayerSession.id === payload.id && payload.revision < multiplayerSession.revision) return;
  const previousOwned = multiplayerSession.owned_character_ids || [];
  const previousCanExplore = multiplayerSession.can_explore;
  const previousPlayers = JSON.stringify(multiplayerSession.players || []);
  const previousPositions = displayedCharacterPositions();
  const activeId = state?.activeCharacterId;
  const oldRoom = multiplayerSession.id;
  const floorChanged = Boolean(payload.state_json && state && (payload.state_json.level !== state.level || payload.state_json.seed !== state.seed));
  const previousViewerVisibility = !floorChanged && oldRoom === payload.id && state?.sharedRoom === true
    ? state.visibility
    : null;
  if (oldRoom !== payload.id) for (const input of document.querySelectorAll(".room-option input")) delete input.dataset.dirty;
  multiplayerSession = { ...(oldRoom === payload.id ? multiplayerSession : {}), ...payload };
  if (payload.id && oldRoom !== payload.id) history.replaceState(null, "", `/site/?room=${encodeURIComponent(payload.id)}`);
  if (payload.invite_code) multiplayerSession.inviteCode = payload.invite_code;
  if (payload.invite_url) multiplayerSession.inviteUrl = payload.invite_url;
  const newOwned = (payload.owned_character_ids || []).filter((id) => !previousOwned.includes(id) &&
    !isFloatingDisc(payload.state_json?.characters?.find(character => character.id === id)));
  for (const id of newOwned) putCharacterFirst(id);
  if (payload.state_json) {
    applyingSharedState = true;
    try {
      const nextState = hydrateDungeonState(payload.state_json);
      restoreMonsterSpellStats(nextState,shadowdarkContent?.monsters);
      const motions = nextState.multiplayerMotions || [];
      const remoteMotions = [];
      if (oldRoom !== payload.id || nextState.rest?.phase === 'sleeping' && nextState.rest.scene?.startedAt !== state?.rest?.scene?.startedAt) {
        resetSharedMotionPlayback(motions);
      } else {
        const owned = new Set(multiplayerSession.owned_character_ids || []);
        for (const motion of motions) {
          if (seenSharedMotionIds.has(motion.id)) continue;
          rememberSharedMotionId(motion.id);
          const initiatedHere = motion.actorId
            ? motion.actorId === multiplayerSession.current_player_id
            : owned.has(motion.characterId);
          if (!initiatedHere) remoteMotions.push(motion);
        }
      }
      state = nextState;
      state.sharedRoom = true;
      if (floorChanged) {
        setupCanvasLayers(state); ui.levelInput.value = state.level; ui.seedInput.value = state.seed;
        resetSharedMotionPlayback(motions);
      }
      const owned = multiplayerSession.owned_character_ids || [];
      state.visibility = previousViewerVisibility || createSharedViewerVisibility(
        nextState.visibility,
        payload.viewer_visibility || {}
      );
      attachSharedViewerScope(state, owned);
      const combatEntry = nextState.combat?.active ? nextState.combat.turnOrder?.[nextState.combat.turnIndex] : null;
      const activeDisc = state.characters.find(character => character.id === activeId && isFloatingDisc(character) &&
        owned.includes(character.id) && character.summon.casterId === combatEntry?.id);
      state.activeCharacterId = combatEntry?.type === 'character' ? activeDisc?.id || combatEntry.id : newOwned.at(-1) || (owned.includes(activeId) ? activeId : owned[0]) || null;
      if (state.activeCharacterId) syncPlayerToActiveCharacter();
      const initialized = new Set();
      for (const motion of remoteMotions) {
        if (initialized.has(motion.characterId) || sharedMotionQueues.has(motion.characterId) ||
            sharedCharacterVisualPositions.has(motion.characterId)) continue;
        initialized.add(motion.characterId);
        setSharedCharacterVisualPosition(
          motion.characterId,
          previousPositions.get(motion.characterId) || motion.frames[0]
        );
      }
      applySharedCharacterVisualPositions();
      recomputeVisibility(state);
      replayPendingSharedMoves();
      redrawFromHydratedState(options.message || payload.state_json.activity?.at(-1)?.message || "");
      if (!ui.spellDetailModal.hidden) {
        const caster = state.characters.find(character => character.id === ui.spellDetailModal.dataset.characterId);
        const spell = findSpellRecord(ui.spellDetailModal.dataset.spellKey);
        if (caster && spell) renderSpellDetail(spell, caster, { readOnly: ui.spellDetailModal.classList.contains('is-advancement-preview') });
      }
      for (const motion of remoteMotions) queueSharedMotionAnimation(motion);
      queueMonsterTurnPresentations(nextState.monsterTurnEvents || [], oldRoom !== payload.id);
      if (floorChanged || oldRoom !== payload.id || newOwned.length) {
        const focus = state.characters.find((item) => item.id === state.activeCharacterId) || state.player;
        const center = getMapViewCenter(ui.mapHost.parentElement);
        viewport.panX = center.x - (Number(focus.x) + .5) * TILE_SIZE_PX * viewport.scale;
        viewport.panY = center.y - (Number(focus.y) + .5) * TILE_SIZE_PX * viewport.scale;
        commitViewportTransform();
      }
      const sheetId = ui.characterSheetContent?.dataset.characterId;
      const sheetCharacter = state.characters.find((item) => item.id === sheetId);
      if (!ui.characterSheetModal?.hidden && sheetCharacter && !ui.characterSheetContent.contains(document.activeElement)) renderCharacterDetail(sheetCharacter, ui.characterSheetContent, { popout: true });
    } finally { applyingSharedState = false; }
  }
  if (multiplayerSession.id) history.replaceState(null, "", `/site/?room=${encodeURIComponent(multiplayerSession.id)}`);
  if (!payload.state_json && previousCanExplore !== multiplayerSession.can_explore && state) {
    updatePanels();
  }
  const playersChanged = previousPlayers !== JSON.stringify(multiplayerSession.players || []);
  if (!options.silentMetadata || payload.state_json || playersChanged || previousCanExplore !== multiplayerSession.can_explore) renderMultiplayerUi();
}

function setMultiplayerStatus(message, tone = "") {
  ui.multiplayerStatus.textContent = message || "";
  ui.multiplayerStatus.dataset.tone = tone;
}

function selectedRoomOptions() {
  const options = Object.fromEntries(["autonomous_exploration", "players_can_import", "extra_characters_without_host", "bury_others"].map((key) =>
    [key, document.getElementById(`room-option-${key}`)?.checked === true]));
  if (!options.players_can_import) options.extra_characters_without_host = false;
  return options;
}

function syncMultipleCharacterOption() {
  const importInput = document.getElementById("room-option-players_can_import");
  const multipleInput = document.getElementById("room-option-extra_characters_without_host");
  const enabled = importInput?.checked === true;
  if (!multipleInput) return;
  multipleInput.disabled = !enabled;
  if (!enabled) multipleInput.checked = false;
  document.getElementById("room-option-multiple-row")?.classList.toggle("is-disabled", !enabled);
}

function renderMultiplayerUi() {
  if (SERVER_RUNTIME || !ui.multiplayerPresenceList) return;
  const active = isSharedRoom();
  const host = multiplayerSession.role === "host";
  ui.multiplayerHostSection.hidden = active && !host;
  ui.multiplayerJoinSection.hidden = active;
  ui.multiplayerCreateHostBtn.textContent = active ? "New Invite Code" : "Host This Dungeon";
  ui.multiplayerInviteRow.hidden = !host || !multiplayerSession.inviteUrl;
  ui.multiplayerInviteLink.value = multiplayerSession.inviteUrl || "";
  document.getElementById("multiplayer-invite-code").textContent = host ? (multiplayerSession.inviteCode || "") : "";
  ui.multiplayerTitle.textContent = active ? multiplayerSession.name || "Dungeon Party" : "Multiplayer";
  ui.multiplayerBtn.textContent = "Multiplayer";
  ui.multiplayerRefreshBtn.disabled = !active;
  document.getElementById("room-save-options").hidden = !active || !host;
  document.getElementById("room-close-session").hidden = !active || !host;
  document.getElementById("room-close-session").textContent = multiplayerSession.closed ? "Reopen Dungeon" : "Close Dungeon";
  document.getElementById("room-leave-session").hidden = !active;
  document.getElementById("room-lock-joins").closest("label").hidden = !active || !host;
  if (active) {
    for (const [key, value] of Object.entries(multiplayerSession.options || {})) {
      const input = document.getElementById(`room-option-${key}`);
      if (!input.dataset.dirty) input.checked = value;
    }
    const lock = document.getElementById("room-lock-joins");
    if (!lock.dataset.dirty) lock.checked = multiplayerSession.joins_locked === true;
  }
  syncMultipleCharacterOption();
  document.getElementById("room-account-links").hidden = active ? multiplayerSession.authenticated : accountSession.authenticated;
  const accountLink = document.getElementById("account-link");
  accountLink.href = accountSession.authenticated ? "/account" : `/login?next=${encodeURIComponent(location.pathname + location.search)}`;
  accountLink.textContent = accountSession.authenticated ? "Account" : "Sign In";
  for (const link of document.querySelectorAll("[data-room-login]")) {
    link.href = `/${link.dataset.roomLogin}?next=${encodeURIComponent(location.pathname + location.search)}`;
  }
  ui.saveBtn.disabled = active && !host;
  ui.generateBtn.disabled = active;
  const importAllowed = canUseRoomCharacterImport();
  if (ui.importCharacterBtn && ui.importCharacterBtn.dataset.busy !== "true") ui.importCharacterBtn.disabled = !importAllowed;
  if (ui.baseClassesOnlyToggle) ui.baseClassesOnlyToggle.disabled = !importAllowed;
  if (ui.loadCharacterBtn) ui.loadCharacterBtn.disabled = active && (!multiplayerSession.authenticated || !importAllowed);
  if (ui.wanderingNumerator) ui.wanderingNumerator.disabled = active;
  if (ui.wanderingDenominator) ui.wanderingDenominator.disabled = active;
  ui.multiplayerPresenceList.replaceChildren();
  const players = multiplayerSession.players || [];
  const assignments = multiplayerSession.assignments || {};
  const ownership = multiplayerSession.ownership || {};
  const characters = (state?.characters || []).filter(character => !isFloatingDisc(character));
  const playerNames = new Map(players.map((player) => [player.id, player.display_name]));
  const roomHost = players.find((player) => player.role === "host");
  for (const player of players) {
    const row = document.createElement("div");
    row.className = "multiplayer-presence-row";
    const label = document.createElement("span");
    label.textContent = `${player.display_name} (${player.role}, ${player.online ? "online" : "away"})`;
    row.append(label);
    if (host) {
      const controls = document.createElement("div");
      controls.className = "multiplayer-player-controls";
      const select = document.createElement("select");
      select.setAttribute("aria-label", `Character assigned to ${player.display_name}`);
      const none = document.createElement("option");
      none.value = "";
      none.textContent = "(none)";
      select.append(none);
      for (const character of characters) {
        const option = document.createElement("option");
        option.value = character.id;
        const ownerId = ownership[character.id];
        const isUnassigned = Boolean(roomHost && ownerId === roomHost.id && assignments[roomHost.id] !== character.id);
        const ownerLabel = ownerId && ownerId !== player.id ? playerNames.get(ownerId) : "";
        option.textContent = `${character.name || "Character"}${isUnassigned ? " (unassigned)" : ownerLabel ? ` (${ownerLabel})` : ""}`;
        select.append(option);
      }
      select.value = assignments[player.id] || "";
      select.disabled = characters.length === 0;
      select.addEventListener("change", () => {
        select.disabled = true;
        void roomHostAction("assignments", { player_id: player.id, character_id: select.value || null }, "PATCH");
      });
      controls.append(select);
      if (player.role !== "host") {
        const kick = document.createElement("button");
        kick.textContent = "Remove";
        kick.addEventListener("click", () => {
          if (confirm(`Remove ${player.display_name} from this dungeon?`)) void roomHostAction(`players/${player.id}/kick`);
        });
        controls.append(kick);
      }
      row.append(controls);
    } else {
      const assigned = characters.find((character) => character.id === assignments[player.id]);
      const assignment = document.createElement("span");
      assignment.className = "multiplayer-presence-meta";
      assignment.textContent = assigned?.name || "No character assigned";
      row.append(assignment);
    }
    ui.multiplayerPresenceList.append(row);
  }
  const banner = document.getElementById("room-state-banner");
  banner.textContent = !active ? "" : multiplayerSession.closed ? "Dungeon closed." :
    !multiplayerSession.can_explore ? "Host away: dungeon paused." :
    !(multiplayerSession.owned_character_ids || []).length ?
      (importAllowed ? "Load or import your character to join the dungeon." : "Waiting for the host to assign your character.") :
    !multiplayerSession.host_present ? "Host away: autonomous exploration enabled." : "";
  banner.hidden = !banner.textContent;
  ensureMultiplayerRefreshLoop();
}

function openMultiplayerModal() {
  ui.multiplayerModal.hidden = false;
  renderMultiplayerUi();
}
function closeMultiplayerModal() { ui.multiplayerModal.hidden = true; }

function ensureMultiplayerRefreshLoop() {
  if (!isSharedRoom()) {
    if (multiplayerRefreshTimer) clearInterval(multiplayerRefreshTimer);
    if (multiplayerHeartbeatTimer) clearInterval(multiplayerHeartbeatTimer);
    multiplayerRefreshTimer = null;
    multiplayerHeartbeatTimer = null;
    return;
  }
  if (!multiplayerRefreshTimer) multiplayerRefreshTimer = setInterval(() => {
    if (document.visibilityState === "visible") void refreshMultiplayerSession({ silent: true });
  }, 500);
  if (!multiplayerHeartbeatTimer) multiplayerHeartbeatTimer = setInterval(() => {
    if (document.visibilityState === "visible") void refreshMultiplayerSession({ silent: true, heartbeat: true });
  }, 5000);
}

async function restoreRoomFromUrlIfPresent() {
  const params = new URL(location.href).searchParams;
  const roomId = params.get("room");
  const code = params.get("join");
  if (params.has("loadRun")) {
    const runId = Number(params.get("loadRun"));
    try {
      const joined = await listJoinedRooms();
      const room = joined.results.find((item) => item.saved_run_id === runId);
      await loadSelectedRun(room ? { ...room, room_id: room.id } : { id: runId });
    } catch (error) { setStatus(error.message); }
    return;
  }
  if (!roomId && !code) return;
  try {
    if (roomId) {
      applyMultiplayerSessionState(await roomRequest(roomId, "resume", {}));
      setStatus("Dungeon loaded.");
    } else {
      ui.multiplayerJoinCode.value = normalizeSessionCode(code);
      await joinMultiplayerHost({ fromUrl: true });
    }
  } catch (error) { setStatus(error.message); }
}

async function createMultiplayerHost() {
  setMultiplayerStatus("Creating invitation...");
  try {
    const result = isSharedRoom()
      ? await roomRequest(multiplayerSession.id, "invite", {})
      : await createHostSession(state, selectedRoomOptions());
    if (result.id) applyMultiplayerSessionState(result);
    else {
      multiplayerSession.inviteCode = result.invite_code;
      multiplayerSession.inviteUrl = result.invite_url;
      renderMultiplayerUi();
    }
    setMultiplayerStatus("Invitation ready. This code remains valid for 5 minutes; joined players stay connected.");
  } catch (error) { setMultiplayerStatus(error.message, "error"); }
}

async function joinMultiplayerHost(options = {}) {
  try {
    applyMultiplayerSessionState(await joinHostSession(ui.multiplayerJoinCode.value, {
      displayName: document.getElementById("room-display-name").value
    }));
    const message = multiplayerSession.authenticated
      ? "Joined. Load or import your character."
      : multiplayerSession.options?.players_can_import
        ? "Joined as a guest. Import your character; no account is required."
        : "Joined as a guest. No account is required; the host will assign your character.";
    setMultiplayerStatus(message);
    if (options.fromUrl) setStatus(message);
  } catch (error) {
    setMultiplayerStatus(error.message, "error");
    if (options.fromUrl) setStatus(error.message);
  }
}

async function refreshMultiplayerSession(options = {}) {
  if (!isSharedRoom() || multiplayerRefreshInFlight || sharedEditTimers.size || (sharedCommandPending && !options.heartbeat)) return;
  if (state.rest?.phase === 'sleeping' && Date.now() - lastRestHeartbeatAt >= 1000) options = { ...options, heartbeat: true };
  if (options.heartbeat && state.rest?.phase === 'sleeping') lastRestHeartbeatAt = Date.now();
  multiplayerRefreshInFlight = true;
  try {
    const result = options.heartbeat
      ? await roomRequest(multiplayerSession.id, "presence", {
        revision: multiplayerSession.revision,
        viewer_visibility: serializeSharedViewerVisibility()
      })
      : await getHostSession(multiplayerSession.id, multiplayerSession.revision);
    applyMultiplayerSessionState(result, { silentMetadata: options.silent === true && !options.heartbeat });
    if (!options.silent) setMultiplayerStatus("Party refreshed.");
  } catch (error) {
    setMultiplayerStatus(error.message, "error");
    if (error.status === 404) {
      multiplayerSession.can_explore = false;
      setStatus("Dungeon access is no longer available.");
    } else setStatus("Connection interrupted. Reconnecting to the dungeon...");
  } finally { multiplayerRefreshInFlight = false; }
}

async function requestRoomHostChange(action, extra = {}, method = "POST") {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      return await roomRequest(multiplayerSession.id, action, {
        revision: multiplayerSession.revision, ...extra
      }, method);
    } catch (error) {
      if (error.status !== 409 || attempt) throw error;
      applyMultiplayerSessionState(await getHostSession(multiplayerSession.id));
    }
  }
}

async function roomHostAction(action, extra = {}, method = "POST") {
  try {
    const result = await requestRoomHostChange(action, extra, method);
    if (action === "options") for (const input of document.querySelectorAll(".room-option input")) delete input.dataset.dirty;
    applyMultiplayerSessionState(result);
    setMultiplayerStatus("Dungeon updated.");
  } catch (error) { setMultiplayerStatus(error.message, "error"); await refreshMultiplayerSession({ silent: true }); }
}

async function leaveSharedRoom() {
  if (!isSharedRoom()) return;
  const roomId = multiplayerSession.id;
  const viewerVisibility = serializeSharedViewerVisibility();
  sharedCommandGeneration += 1;
  if (sharedMoveFlushTimer) clearTimeout(sharedMoveFlushTimer);
  sharedMoveFlushTimer = null;
  pendingSharedMoves.splice(0);
  sharedMoveBuffer.splice(0);
  sharedMoveBatchesOutstanding = 0;
  for (const timer of sharedEditTimers.values()) clearTimeout(timer);
  sharedEditTimers.clear();
  sharedCommandQueue = Promise.resolve();
  sharedCommandPending = 0;
  resetSharedMotionPlayback();
  multiplayerSession = { players: [], assignments: [] };
  if (saveMenus) void saveMenus.syncConsensus();
  if (state) {
    state.sharedRoom = false;
    render({ motionOnly: true });
  }
  history.replaceState(null, "", "/site/");
  renderMultiplayerUi();
  void roomRequest(roomId, "leave", { viewer_visibility: viewerVisibility }, "POST", {
    timeoutMs: 3000
  }).catch(() => {});
}

async function copyMultiplayerInviteLink() {
  try {
    await navigator.clipboard.writeText(multiplayerSession.inviteUrl);
    setMultiplayerStatus("Invite link copied.");
  } catch { ui.multiplayerInviteLink.select(); }
}

function hookInputEvents() {
  document.getElementById('party-attack-no').addEventListener('click', () => { pendingPartyAttack = null; document.getElementById('party-attack-modal').hidden = true; });
  document.getElementById('party-attack-yes').addEventListener('click', () => {
    const pending = pendingPartyAttack; pendingPartyAttack = null; document.getElementById('party-attack-modal').hidden = true;
    if (!pending || pending.turnKey !== targetingTurnKey()) return;
    const actor = state.characters.find(character => character.id === pending.actorId), target = state.characters.find(character => character.id === pending.targetId);
    if (actor && target && canControlCharacter(actor)) resolveCharacterAttackAgainstMonster(actor, pending.attack, target);
    updatePanels(); render();
  });
  document.getElementById('steal-cancel').addEventListener('click', () => {
    const thief = state.characters.find(character => character.pendingSteal && canControlCharacter(character));
    if (thief) resolveSteal(thief, { cancel: true });
  });
  document.getElementById('treasure-attack-close').addEventListener('click',()=>{document.getElementById('treasure-attack-modal').hidden=true;});
  document.getElementById('reaction-yes').addEventListener('click',()=>answerReaction(true));
  document.getElementById('reaction-no').addEventListener('click',()=>answerReaction(false));
  document.getElementById('rest-btn').addEventListener('click', () => {
    document.getElementById('rest-modal').dataset.showResults = 'false';
    updateRestUi(); document.getElementById('rest-modal').hidden = false; positionRestModal(true);
  });
  document.getElementById('rest-close').addEventListener('click', () => { document.getElementById('rest-modal').hidden = true; render(); });
  document.getElementById('rest-confirm').addEventListener('click', () => performRestAction(state.rest?.phase === 'voting' ? 'rest_accept' : 'rest'));
  document.getElementById('rest-cancel').addEventListener('click', () => performRestAction('rest_cancel'));
  document.getElementById('spell-critical-modal')?.addEventListener('click', event => {
    const button = event.target.closest('[data-healing-choice]');
    if (!button || button.disabled) return;
    const caster = state?.characters.find(character => character.id === event.currentTarget.dataset.characterId);
    finishCriticalHealing(caster, button.dataset.healingChoice);
  });
  document.getElementById('missile-critical-modal').addEventListener('click', event => {
    const button = event.target.closest('[data-missile-choice]');
    if (!button || button.disabled) return;
    const caster = state.characters.find(character => character.id === event.currentTarget.dataset.characterId);
    resolveMagicMissile(caster, { choice: button.dataset.missileChoice });
  });
  document.getElementById('magic-missile-finish').addEventListener('click', () => {
    targetingMode = null; missileDisplay = null; syncMagicMissileUi(); render();
  });
  document.getElementById('offensive-spell-cast').addEventListener('click', async () => {
    await ensureSpellLibraryLoaded();
    const caster = state.characters.find(character => character.id === targetingMode?.characterId);
    performSpellCast(caster, findSpellRecord(targetingMode?.spellKey));
  });
  document.getElementById('offensive-spell-release').addEventListener('click', () => {
    resolveBurningHands(state.characters.find(character => character.id === targetingMode?.characterId));
  });
  document.getElementById('offensive-spell-discard').addEventListener('click', () => {
    const caster = state.characters.find(character => character.id === targetingMode?.characterId);
    if (!caster) return;
    if (caster.pendingSpell?.spell === 'magic missile') resolveMagicMissile(caster, { dismiss: true });
    else if (caster.pendingSpell?.spell === 'burning hands') resolveBurningHands(caster, { dismiss: true });
  });
  document.getElementById('offensive-spell-details').addEventListener('click', async () => {
    await ensureSpellLibraryLoaded();
    const caster = state.characters.find(character => character.id === targetingMode?.characterId);
    const spell = findSpellRecord(targetingMode?.spellKey);
    if (caster && spell) renderSpellDetail(spell, caster);
  });
  document.getElementById('burning-critical-modal').addEventListener('click', event => {
    const button = event.target.closest('[data-burning-choice]');
    if (!button || button.disabled) return;
    resolveBurningHands(state.characters.find(character => character.id === event.currentTarget.dataset.characterId), { choice: button.dataset.burningChoice });
  });
  document.addEventListener("keydown", (event) => {
    if (!state) {
      return;
    }
    if (event.key === 'Shift') { shiftAttackHeld = true; updateMonsterHoverCursor(); }
    const advancementModal = document.getElementById('advancement-modal');
    if (advancementModal && !advancementModal.hidden && ui.spellDetailModal.hidden) {
      if (event.key === 'Escape') { event.preventDefault(); advancementModal.hidden = true; }
      else if (!event.target.closest?.('#advancement-modal')) event.preventDefault();
      return;
    }
    if (event.key === 'Escape') {
      if (activeColorPicker) { closeActiveColorPicker(); return; }
      if (!document.getElementById('party-attack-modal').hidden) { pendingPartyAttack = null; document.getElementById('party-attack-modal').hidden = true; return; }
      if (!ui.extinguishOldModal.hidden) { closeExtinguishOldModal(); return; }
      const thief = state.characters.find(character => character.pendingSteal && canControlCharacter(character));
      if (thief) { event.preventDefault(); resolveSteal(thief, { cancel: true }); return; }
      if (currentTargetingOverlay()) { event.preventDefault(); targetingMode = null; dismissedTurnRadius = targetingTurnKey(); syncMagicMissileUi(); updateMonsterHoverCursor(); render(); return; }
    }
    if (activeShopPanel || activeSellPanel) {
      if (event.key === 'Escape') {
        event.preventDefault(); closeActiveShopPanel(); closeActiveSellPanel();
      } else if (!['Tab', 'Enter', ' '].includes(event.key) && !['INPUT', 'SELECT', 'TEXTAREA'].includes(event.target?.tagName)) event.preventDefault();
      return;
    }
    const criticalModal = ['party-attack-modal','steal-modal','treasure-attack-modal','reaction-modal','missile-critical-modal', 'burning-critical-modal', 'spell-critical-modal', 'faith-critical-modal'].map(id => document.getElementById(id)).find(modal => !modal.hidden);
    if (criticalModal) {
      if (event.key === 'Tab') {
        const buttons = [...criticalModal.querySelectorAll('button:not(:disabled)')];
        if (buttons.length) {
          event.preventDefault();
          const index = buttons.indexOf(document.activeElement);
          buttons[(index + (event.shiftKey ? buttons.length - 1 : 1)) % buttons.length].focus();
        }
      } else if (!['Enter', ' '].includes(event.key)) event.preventDefault();
      return;
    }
    if (!ui.spellcastingModal.hidden) {
      if (event.key === 'Escape') { event.preventDefault(); closeSpellcastingMenu(); }
      else if (event.key === 'Tab') {
        const controls = [...ui.spellcastingModal.querySelectorAll('button:not(:disabled)')];
        if (controls.length) {
          event.preventDefault();
          const index = controls.indexOf(document.activeElement);
          controls[(index + (event.shiftKey ? controls.length - 1 : 1)) % controls.length].focus();
        }
      } else if (!['Enter', ' '].includes(event.key)) event.preventDefault();
      return;
    }
    if (event.target.closest?.('.spellcasting-menu-button, #spellcasting-modal')) return;
    if (!document.getElementById('rest-modal').hidden && event.key !== 'Tab' && event.key !== 'Enter' && event.key !== ' ') { event.preventDefault(); return; }
    const targetTag = event.target?.tagName || "";
    if (targetTag === 'BUTTON' && ['Enter', ' '].includes(event.key)) return;
    if (["INPUT", "TEXTAREA", "SELECT"].includes(targetTag)) {
      return;
    }
    if (event.key === "Enter" && getCurrentCombatEntry()?.type === "character") {
      event.preventDefault();
      endCurrentTurn();
      ui.mapHost?.focus?.();
      return;
    }
    if (event.key === "+" || event.key === "=") {
      event.preventDefault();
      zoomMapBy(1.16);
      return;
    }
    if (event.key === "-" || event.key === "_") {
      event.preventDefault();
      zoomMapBy(1 / 1.16);
      return;
    }
    if (event.key === "i" || event.key === "I") {
      if (ui.characterSheetModal && !ui.characterSheetModal.hidden) {
        event.preventDefault();
        closeCharacterSheet();
        return;
      }
      const active = getExplicitActiveCharacter(state);
      if (active) {
        event.preventDefault();
        openCharacterSheet(active);
      }
      return;
    }
    const moves = {
      ArrowUp: [0, -1],
      ArrowDown: [0, 1],
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
      Numpad1: [-1, 1],
      Numpad2: [0, 1],
      Numpad3: [1, 1],
      Numpad4: [-1, 0],
      Numpad6: [1, 0],
      Numpad7: [-1, -1],
      Numpad8: [0, -1],
      Numpad9: [1, -1]
    };
    const delta = moves[event.code] || moves[event.key];
    if (delta) {
      event.preventDefault();
      clickMoveGeneration += 1;
      if (sendSharedCommand("move", { dx: delta[0], dy: delta[1] })) return;
      applyLocalMovement(delta);
      return;
    }
    if (event.key === "s" || event.key === "S") {
      event.preventDefault();
      performSearch();
      return;
    }
    if (event.key === "g" || event.key === "G") {
      event.preventDefault();
      performGet();
      return;
    }
    if (event.key === "l" || event.key === "L") {
      event.preventDefault();
      performLeave();
      return;
    }
  });

  ui.generateBtn.addEventListener("click", () => {
    generateAndRender();
  });
  ui.dungeonTabBtn?.addEventListener("click", () => setActiveTab("dungeon"));
  ui.charactersTabBtn?.addEventListener("click", () => {
    setActiveTab("characters");
    if (state?.characters?.length) {
      openCharacterSheet(getActiveCharacter(state));
    }
  });
  syncBaseClassesOnlyToggleState(readBaseClassesOnlyPreference());
  ui.baseClassesOnlyToggle?.addEventListener("change", () => {
    syncBaseClassesOnlyToggleState(ui.baseClassesOnlyToggle.checked);
  });
  ui.importCharacterBtn.addEventListener("click", () => {
    importShadowdarklingsCharacterOneClick();
  });
  ui.manualDiceControls?.addEventListener("click", (event) => {
    const button = event.target.closest(".manual-die-button");
    if (button) {
      applyManualDieRoll(button);
    }
  });
  ui.manualDiceControls?.addEventListener("input", (event) => {
    if (event.target.matches("input[type='number']")) {
      sizeControlField(event.target);
    }
  });
  ui.manualDieReset?.addEventListener("click", resetManualDieControls);
  ui.diceHistoryToggle?.addEventListener("click", toggleDiceHistory);
  ui.damageExpandBtn?.addEventListener("click", () => {
    setDamageDetailVisibility(ui.damageDetail.hidden);
  });
  if (ui.characterSheetClose) {
    ui.characterSheetClose.addEventListener("click", closeCharacterSheet);
  }
  const characterSheetCard = getCharacterSheetCard();
  characterSheetCard?.addEventListener("pointerdown", startCharacterSheetDrag);
  characterSheetCard?.addEventListener("pointermove", dragCharacterSheet);
  characterSheetCard?.addEventListener("pointerup", stopCharacterSheetDrag);
  characterSheetCard?.addEventListener("pointercancel", stopCharacterSheetDrag);
  if (ui.characterSheetModal) {
    ui.characterSheetModal.addEventListener("click", (event) => {
      if (event.target === ui.characterSheetModal) {
        closeCharacterSheet();
      }
    });
  }
  document.getElementById('spellcasting-close')?.addEventListener('click', closeSpellcastingMenu);
  ui.spellcastingModal?.addEventListener('click', event => {
    if (event.target === ui.spellcastingModal) closeSpellcastingMenu();
  });
  ui.spellDetailClose?.addEventListener("click", () => {
    ui.spellDetailModal.hidden = true;
  });
  ui.spellDetailModal?.addEventListener("click", (event) => {
    if (event.target === ui.spellDetailModal) {
      ui.spellDetailModal.hidden = true;
    }
  });
  ui.levelInput.addEventListener("input", () => {
    sizeControlField(ui.levelInput);
    updateHowToPlayLevel();
  });

  ui.howToPlayBtn?.addEventListener("click", () => {
    const expanded = ui.howToPlayBtn.getAttribute("aria-expanded") === "true";
    ui.howToPlayBtn.setAttribute("aria-expanded", expanded ? "false" : "true");
    if (ui.howToPlayContent) {
      ui.howToPlayContent.hidden = expanded;
    }
  });

  ui.saveBtn.addEventListener("click", () => {
    document.getElementById('save-load-menu').hidden = true;
    openSaveLoadModal("save");
  });

  ui.loadBtn.addEventListener("click", () => {
    document.getElementById('save-load-menu').hidden = true;
    openSaveLoadModal("load");
  });

  ui.loadCharacterBtn?.addEventListener("click", () => {
    document.getElementById('save-load-menu').hidden = true;
    openSaveLoadModal("load-character");
  });
  const saveLoadMenu = document.getElementById('save-load-menu');
  document.getElementById('save-load-menu-btn')?.addEventListener('click', () => { saveLoadMenu.hidden = false; });
  document.getElementById('save-load-menu-close')?.addEventListener('click', () => { saveLoadMenu.hidden = true; });
  saveLoadMenu?.addEventListener('click', event => { if (event.target === saveLoadMenu) saveLoadMenu.hidden = true; });
  document.getElementById('save-character-menu-btn')?.addEventListener('click', () => {
    saveLoadMenu.hidden = true;
    const character = getExplicitActiveCharacter(state);
    if (character && ownsCharacter(character)) saveCharacterSnapshot(character);
    else setStatus('Select one of your characters to save.');
  });
  document.getElementById('save-party-menu-btn')?.addEventListener('click', () => { saveLoadMenu.hidden = true; void getSaveMenus().openSaveParty(); });
  document.getElementById('load-party-menu-btn')?.addEventListener('click', () => { saveLoadMenu.hidden = true; void getSaveMenus().openLoadParty(); });

  ui.multiplayerBtn?.addEventListener("click", openMultiplayerModal);
  ui.multiplayerCreateHostBtn?.addEventListener("click", createMultiplayerHost);
  ui.multiplayerJoinBtn?.addEventListener("click", joinMultiplayerHost);
  ui.multiplayerRefreshBtn?.addEventListener("click", refreshMultiplayerSession);
  document.getElementById("room-save-options")?.addEventListener("click", () => roomHostAction("options", {
    ...selectedRoomOptions(), joins_locked: document.getElementById("room-lock-joins").checked
  }, "PATCH"));
  for (const input of document.querySelectorAll(".room-option input")) input.addEventListener("change", () => {
    input.dataset.dirty = "true";
    if (input.id === "room-option-players_can_import") syncMultipleCharacterOption();
  });
  document.getElementById("room-close-session")?.addEventListener("click", () => roomHostAction(multiplayerSession.closed ? "resume" : "close"));
  document.getElementById("room-leave-session")?.addEventListener("click", async () => {
    try {
      await leaveSharedRoom();
      closeMultiplayerModal();
      await generateAndRender();
    } catch (error) { setMultiplayerStatus(error.message, "error"); }
  });
  ui.multiplayerCopyLinkBtn?.addEventListener("click", copyMultiplayerInviteLink);
  ui.multiplayerClose?.addEventListener("click", closeMultiplayerModal);
  ui.multiplayerModal?.addEventListener("click", (event) => {
    if (event.target === ui.multiplayerModal) {
      closeMultiplayerModal();
    }
  });

  ui.lightTorchBtn.addEventListener("click", () => {
    attemptLightSource("torch");
  });

  ui.lightLanternBtn?.addEventListener("click", () => {
    attemptLightSource("lantern");
  });

  ui.castLightBtn?.addEventListener("click", async () => {
    const active = getActiveCharacter(state);
    if (!canCastLightSpell(active)) {
      return;
    }
    await ensureSpellLibraryLoaded();
    const spell = findSpellRecord("Light") || { name: "Light", tier: 1 };
    performSpellCast(active, spell);
    render();
    updatePanels();
  });

  ui.torchOutBtn?.addEventListener("click", () => {
    if (sendSharedCommand("snuff")) return;
    const active = getActiveCharacter(state);
    if (active?.lightSource === "lantern") {
      extinguishActiveLantern();
      setStatus("Lantern went out!");
    } else if (active?.lightSource === "torch") {
      snuffActiveTorch();
      setStatus("Torch snuffed!");
    } else {
      clearActiveCharacterLight();
      setStatus("Light went out!");
    }
    markUserActivity();
    recomputeVisibility(state);
    render();
    updatePanels();
  });

  ui.searchModifierInput?.addEventListener("change", () => {
    normalizeSearchModifier();
  });
  ui.searchModifierInput?.addEventListener("input", () => {
    const value = Number(ui.searchModifierInput.value);
    sizeControlField(ui.searchModifierInput);
    if (Number.isNaN(value)) {
      return;
    }
    if (value > MAX_SEARCH_MODIFIER || value < MIN_SEARCH_MODIFIER) {
      normalizeSearchModifier();
    }
  });

  ui.searchBtn.addEventListener("click", () => {
    performSearch();
  });

  ui.stealthBtn?.addEventListener("click", () => {
    performStealth();
  });

  ui.endTurnBtn?.addEventListener("click", () => {
    endCurrentTurn();
  });

  ui.pickLockBtn.addEventListener("click", () => {
    if (sendSharedCommand("pick_lock")) return;
    if (!consumeCharacterCombatAction(getActiveCharacter(state))) return;
    const context = getCharacterActionContext("pick");
    const result = attemptLockedDoor(state, "pick", context.modifier, {
      doubleRoll: context.doubleRoll,
      disadvantage: context.disadvantage
    });
    const message = result.opened
      ? `Pick Lock ${result.total}. Lock picked.`
      : `Pick Lock ${result.total}. The lock holds.`;
    markUserActivity();
    setStatus(result.trapSprung ? `${message} ${result.message}` : message);
    showCheckResult(result, "Pick Lock", {
      headline: `Pick Lock ${result.total}`,
      message,
      context
    });
    render();
    updatePanels();
  });

  ui.breakDoorBtn.addEventListener("click", () => {
    if (sendSharedCommand("break_door")) return;
    if (!consumeCharacterCombatAction(getActiveCharacter(state))) return;
    const context = getCharacterActionContext("break");
    const result = attemptLockedDoor(state, "break", context.modifier, {
      doubleRoll: context.doubleRoll,
      disadvantage: context.disadvantage
    });
    const message = result.opened ? "door destroyed." : "you can't budge the door.";
    markUserActivity();
    setStatus(result.trapSprung ? `${message} ${result.message}` : message);
    showCheckResult(result, "Smash", {
      headline: `Smash ${result.total}`,
      message,
      context
    });
    render();
    updatePanels();
  });

  ui.blackoutToggle?.addEventListener("change", () => {
    forceBlackoutWhenTorchOut = ui.blackoutToggle.checked;
    render();
  });

  ui.wanderingNumerator?.addEventListener("input", () => sanitizeWanderingInput(ui.wanderingNumerator));
  ui.wanderingDenominator?.addEventListener("input", () => sanitizeWanderingInput(ui.wanderingDenominator));
  ui.saveNameInput.addEventListener("input", () => {
    ui.saveNameInput.value = ui.saveNameInput.value.slice(0, MAX_SAVE_NAME_LENGTH);
    ui.overwriteConfirmation.hidden = true;
  });
  ui.saveModalSubmit.addEventListener("click", () => saveCurrentRun());
  ui.overwriteConfirmBtn.addEventListener("click", () => saveCurrentRun(saveDialog.pendingRun));
  ui.overwriteCancelBtn.addEventListener("click", () => {
    ui.overwriteConfirmation.hidden = true;
    saveDialog.pendingRun = null;
    ui.saveNameInput.focus();
  });
  ui.replaceConfirmBtn.addEventListener("click", () => loadSelectedRun(saveDialog.pendingRun));
  ui.replaceCancelBtn.addEventListener("click", () => {
    ui.replaceConfirmation.hidden = true;
    saveDialog.pendingRun = null;
  });
  ui.saveLoadClose.addEventListener("click", closeSaveLoadModal);
  ui.lootCompleteClose.addEventListener("click", () => {
    ui.lootCompleteModal.hidden = true;
  });

  ui.extinguishOldYesBtn?.addEventListener("click", () => {
    if (!isPendingLightRequestCurrent()) { closeExtinguishOldModal(); return; }
    const source = pendingLightRequest?.source;
    const gearIndex = pendingLightRequest?.gearIndex;
    closeExtinguishOldModal();
    if (source) {
      attemptLightSource(source, gearIndex, { resetTimer: true });
    }
  });

  ui.extinguishOldNoBtn?.addEventListener("click", () => {
    if (!isPendingLightRequestCurrent()) { closeExtinguishOldModal(); return; }
    const source = pendingLightRequest?.source;
    const gearIndex = pendingLightRequest?.gearIndex;
    closeExtinguishOldModal();
    if (source) {
      attemptLightSource(source, gearIndex, { resetTimer: false });
    }
  });

  ui.extinguishOldModal?.addEventListener("click", (event) => {
    if (event.target === ui.extinguishOldModal) {
      closeExtinguishOldModal();
    }
  });
}

function hookMapViewportInteractions() {
  const panel = ui.mapHost.parentElement;
  document.addEventListener('keyup', event => { if (event.key === 'Shift') { shiftAttackHeld = false; updateMonsterHoverCursor(); } });
  window.addEventListener('blur', () => { shiftAttackHeld = false; updateMonsterHoverCursor(); });
  attackCursorImage = new Image();
  attackCursorImage.onload = updateMonsterHoverCursor;
  attackCursorImage.src = new URL("../assets/attack-alpha.png", import.meta.url).href;
  panel.addEventListener("pointermove", (event) => {
    mapHoverPointer = event.target?.closest?.(".map-zoom-controls") ? null
      : { clientX: event.clientX, clientY: event.clientY };
    updateMonsterHoverCursor();
  });
  panel.addEventListener("pointerleave", () => {
    mapHoverPointer = null;
    updateMonsterHoverCursor();
  });

  const onDocumentMove = (event) => {
    if (!dragState || dragState.pointerId !== event.pointerId) {
      return;
    }
    event.preventDefault();
    const dx = event.clientX - dragState.startX;
    const dy = event.clientY - dragState.startY;
    if (Math.hypot(dx, dy) > DRAG_THRESHOLD_PX) {
      dragState.moved = true;
    }
    viewport.panX = dragState.panStartX + dx;
    viewport.panY = dragState.panStartY + dy;
    commitViewportTransform();
  };

  const finishPointerSequence = (event) => {
    if (!dragState || dragState.pointerId !== event.pointerId) {
      return;
    }
    const wasDrag = dragState.moved;
    const clickX = dragState.clickX;
    const clickY = dragState.clickY;
    const attackIntent = dragState.attackIntent || event.shiftKey || shiftAttackHeld;
    dragState = null;
    panel.classList.remove("is-dragging");
    updateMonsterHoverCursor();
    document.removeEventListener("pointermove", onDocumentMove);
    document.removeEventListener("pointerup", finishPointerSequence);
    document.removeEventListener("pointercancel", finishPointerSequence);

    if (event.type !== "pointerup" || wasDrag || !state || !layers) {
      return;
    }
    const { x, y } = getTileFromPointer({ clientX: clickX, clientY: clickY });
    if (state.characters.some(member => TIER_TWO_SPELLS.has(member.pendingSpell?.spell) && canControlCharacter(member))) {
      const target = getCharacterAtTile(x, y, { includeDiscs: true }) || getVisibleMonsterAtTile(x, y) ||
        state.entities.find(entity => entity.x === x && entity.y === y && !entity.collected && entity.type === 'treasure');
      if (getTierTwoUi().click(x, y, target?.id)) return;
    }
    const lightCaster = state.characters.find(character => character.pendingSpell?.spell === 'light' && canControlCharacter(character));
    if (lightCaster) {
      const target = getCharacterAtTile(x, y, { includeDiscs: true }) || getVisibleMonsterAtTile(x, y) || getRoomLoot(state).find(item => item.x === x && item.y === y);
      finishLightSpell(lightCaster, target ? { targetId: target.id } : { x, y }); return;
    }
    const downstairs = downstairsIn(state);
    if (downstairs?.x === x && downstairs?.y === y && !currentTargetingOverlay()) { void requestDungeonDescent(); return; }
    const blessingCaster = state.characters.find(character => ['holy weapon','invisibility','charm person','hold portal','sleep'].includes(character.pendingSpell?.spell) && character.pendingSpell.phase === 'targeting' && canControlCharacter(character));
    if (blessingCaster?.pendingSpell.spell === 'sleep') { finishFaithSpell(blessingCaster, { x, y }); return; }
    if (blessingCaster?.pendingSpell.spell === 'hold portal') {
      const door = getDoorAt(state, x, y);
      if (door) finishFaithSpell(blessingCaster, { targetId: door.id });
      return;
    }
    const blessingTarget = blessingCaster?.pendingSpell.spell === 'charm person' ? getVisibleMonsterAtTile(x,y) :
      getCharacterAtTile(x,y)||(blessingCaster?.pendingSpell.spell==='invisibility'?getVisibleMonsterAtTile(x,y):null);
    if (blessingCaster && blessingTarget) { finishFaithSpell(blessingCaster, { targetId: blessingTarget.id }); return; }
    if (attackIntent && !getActiveCharacter(state)?.pendingSpell) { performMapAttack(x, y); return; }
    let overlay = currentTargetingOverlay();
    if (overlay?.kind === 'weapon') overlay = null;
    if (overlay?.kind === 'monster') return;
    const targetMonster = getVisibleMonsterAtTile(x, y);
    if (overlay?.kind === 'spell' && targetingMode?.spellKey === 'magic missile' && !targetMonster) {
      resolveMagicMissile(state.characters.find(character => character.id === overlay.characterId), { x, y, blind: true }); return;
    }
    if (overlay && targetMonster) {
      const actor = state.characters.find(character => character.id === overlay.characterId);
      if (overlay.kind === 'steal') { resolveSteal(actor, { targetId: targetMonster.id }); return; }
      if (!canTargetAtRange(state, actor, targetMonster, overlay.range,{directAttack:overlay.kind==='weapon'||targetingMode?.spellKey==='magic missile'})) { setStatus('That target is outside range or line of sight.'); return; }
      if (overlay.kind === 'weapon') attackClickedMonster(targetMonster);
      else if (!hasReadyOffensiveSpell(actor)) setStatus('Cast the spell before choosing its target.');
      else if (targetingMode.spellKey === 'magic missile') resolveMagicMissile(actor, { targetId: targetMonster.id });
      else resolveBurningHands(actor);
      render(); updatePanels();
      return;
    }
    const treasureTarget=state.entities.find(entity=>entity.type==='treasure'&&!entity.collected&&entity.x===x&&entity.y===y);
    if(overlay?.kind==='weapon'&&treasureTarget) {
      const actor=state.characters.find(character=>character.id===overlay.characterId);
      if(!canTargetAtRange(state,actor,treasureTarget,overlay.range))return;
      if(!sendSharedCommand('attack_treasure',{entity_id:treasureTarget.id},actor)) {
        if(!consumeCharacterCombatAction(actor))return;
        revealAfterOffense(actor);markRunDirty();setStatus('That does nothing.');document.getElementById('treasure-attack-modal').hidden=false;updatePanels();render();
      }
      return;
    }
    if (overlay?.kind === 'weapon') {
      const actor = state.characters.find(character => character.id === overlay.characterId);
      const victim = getCharacterAtTile(x, y);
      if (victim && victim.id !== actor.id && targetingMode?.kind === 'weapon') { confirmPartyAttack(actor, victim); return; }
      const door = getDoorAt(state, x, y);
      if (door && targetingMode?.kind === 'weapon') { attackDoor(actor, door.id); return; }
      if (!victim && (!isCombatActive() || !isTileIlluminated(state, x, y, { x, y, routeId: routeOf(state, actor) }))) { attackEmptyTile(actor, x, y); render(); updatePanels(); return; }
    }
    if (tryClickMovement(x, y)) return;
    const clickedCharacter = getCharacterAtTile(x, y, { includeDiscs: true });
    if (clickedCharacter) {
      if (!ownsCharacter(clickedCharacter)) { openCharacterSheet(clickedCharacter); return; }
      if (!activateCharacter(clickedCharacter)) { openCharacterSheet(clickedCharacter); return; }
      markUserActivity();
      setStatus(`Selected ${clickedCharacter.name}.`);
      render();
      updatePanels();
      return;
    }
    if (restInProgress(state) || getActiveCharacter(state)?.pendingSpell && !getDoorAt(state, x, y)) {
      setStatus(restInProgress(state) ? 'Cancel rest before taking an action.' : pendingSpellMessage(getActiveCharacter(state)));
      return;
    }
    const clickedMonster = getVisibleMonsterAtTile(x, y);
    if (isFloatingDisc(getActiveCharacter(state))) {
      const loot = getRoomLoot(state).find(entity => entity.x === x && entity.y === y);
      if (loot) collectForFloatingDisc(loot);
      else setStatus('Floating Disc follows its caster outside combat; select the caster to move.');
      return;
    }
    if(concealedMimic(clickedMonster)) {
      if(!sendSharedCommand('pickup',{entity_id:clickedMonster.id})) {
        setStatus(collectLoot(state,clickedMonster.id));processMonsterVisibilityChange();updatePanels();render();
      }
      return;
    }
    if (clickedMonster) { if (!concealedAnimatedArmor(clickedMonster)) openMonsterSheet(clickedMonster); return; }
    const doorClick = clickedMonster ? null : getDoorClickContext(state, x, y, { canUseCharacter: canControlCharacter });
    if (doorClick?.message) { setStatus(doorClick.message); return; }
    if (doorClick?.character) {
      activateCharacter(doorClick.character);
      render();
      updatePanels();
    }
    if (isSharedRoom()) {
      if (clickedMonster) attackClickedMonster(clickedMonster);
      else sendSharedCommand("interact", { x, y }, doorClick?.character || getActiveCharacter(state));
      return;
    }
    const result = clickedMonster ? attackClickedMonster(clickedMonster) : interactAtDoor(x, y, doorClick?.character || getActiveCharacter(state));
    let sighting = null;
    if (!clickedMonster) {
      sighting = processMonsterVisibilityChange();
    }
    markUserActivity();
    if (!clickedMonster && !sighting?.combatStarted && !sighting?.combatEnded) {
      setStatus(result);
    }
    render();
    if (!/^No interactive token\b|^That tile is hidden by darkness\./.test(result.message || "")) {
      updatePanels();
    }
  };

  panel.addEventListener("wheel", (event) => {
    if (!state) {
      return;
    }
    event.preventDefault();
    const zoomStep = event.deltaY < 0 ? 1.1 : 1 / 1.1;
    applyViewportScale(viewport.scale * zoomStep, pointerInMapView(panel, event.clientX, event.clientY));
  }, { passive: false });

  ui.zoomInBtn?.addEventListener("click", (event) => {
    event.stopPropagation();
    zoomMapBy(1.16);
  });

  ui.zoomOutBtn?.addEventListener("click", (event) => {
    event.stopPropagation();
    zoomMapBy(1 / 1.16);
  });

  panel.addEventListener("pointerdown", (event) => {
    if (event.target.closest?.('#magic-missile-panel, #holy-weapon-panel, #turn-card-layer, .tier-two-target-panel')) return;
    if (event.target?.closest?.(".map-zoom-controls")) {
      return;
    }
    if (event.button !== 0) {
      return;
    }
    dragState = {
      pointerId: event.pointerId,
      attackIntent: event.shiftKey || shiftAttackHeld || targetingMode?.kind === 'weapon',
      startX: event.clientX,
      startY: event.clientY,
      clickX: event.clientX,
      clickY: event.clientY,
      panStartX: viewport.panX,
      panStartY: viewport.panY,
      moved: false
    };
    panel.classList.add("is-dragging");
    updateMonsterHoverCursor();
    document.addEventListener("pointermove", onDocumentMove, { passive: false });
    document.addEventListener("pointerup", finishPointerSequence);
    document.addEventListener("pointercancel", finishPointerSequence);
  });

  panel.addEventListener("contextmenu", (event) => {
    if (!state || !layers) {
      return;
    }
    event.preventDefault();
    const { x, y } = getTileFromPointer(event);
    const character = getCharacterAtTile(x, y, { includeDiscs: true });
    if (!character || character.id === state.activeCharacterId) {
      return;
    }
    if (sendSharedCommand("guard", {}, character)) return;
    character.guarding = !character.guarding;
    markUserActivity();
    setStatus(character.guarding ? `${character.name} is guarding.` : `${character.name} stops guarding.`);
    render();
    updatePanels();
  });

  window.addEventListener("resize", () => {
    if (state) {
      applyViewportScale(viewport.scale);
    }
    if (ui.characterSheetModal && !ui.characterSheetModal.hidden) {
      positionCharacterSheetModal();
    }
  });
}

async function loadLocalTestParty() {
  if(SERVER_RUNTIME||!['127.0.0.1','localhost','[::1]'].includes(location.hostname)||
     new URLSearchParams(location.search).get('test-party')!=='three'||
     new URLSearchParams(location.search).has('room')||isSharedRoom()||state.characters.length)return;
  const dungeon=state;
  try {
    const response=await fetch('/__preview__/test-party',{cache:'no-store'});
    if(!response.ok)throw new Error('The local three-character fixture is unavailable.');
    const imported=extractShadowdarkCharacters(JSON.stringify(await response.json()));
    if(imported.length!==3)throw new Error('The local fixture must contain exactly three characters.');
    if(state!==dungeon||isSharedRoom()||state.characters.length)return;
    if (new URLSearchParams(location.search).get('magic-test') === 'one') {
      const wizard = imported.find(character => /wizard/i.test(character.className));
      wizard.spellsKnown = [...new Set([...wizard.spellsKnown.split(/,\s*/), 'Detect Magic', 'Feather Fall'])].join(', ');
      wizard.gear.push(enchantedEquipment(rulesData.weapons.find(item => item.name === 'dagger'), 'weapon', 2),
        magicPotion('healing-1'), magicPotion('giant-strength'), magicScroll(findSpellRecord('Burning Hands')));
    }
    if (new URLSearchParams(location.search).get('utility-test') === 'one') {
      const wizard = imported.find(character => /wizard/i.test(character.className));
      wizard.spellsKnown = [...new Set([...wizard.spellsKnown.split(/,\s*/), 'Alarm', 'Floating Disc', 'Mage Armor', 'Hold Portal', 'Sleep'])].join(', ');
      wizard.gear.push({ name: 'Rations', quantity: 3, totalUnits: 3, slots: 1 },
        { name: 'Lantern', quantity: 1, slots: 1 }, { name: 'Oil flask', quantity: 1, slots: 1 });
    }
    if (new URLSearchParams(location.search).get('tier-two-test') === 'one') {
      const wizard = imported.find(character => /wizard/i.test(character.className));
      wizard.spellsKnown = [...TIER_TWO_SPELLS, 'invisibility', 'Light', 'Magic Missile', 'Burning Hands'].map(name => name.replace(/\b\w/g, letter => letter.toUpperCase())).join(', ');
      wizard.level = 4; wizard.stats.INT = 18;
      for (const member of imported) { member.hp = member.maxHitPoints = 60; member.luckToken = true; }
    }
    if (new URLSearchParams(location.search).get('initial-choices') === 'one') {
      for (const character of imported) initializeImportChoices(character);
    }
    for(const character of [...imported].reverse())putCharacterFirst(character.id);
    placeCharactersNearStartingStairs(imported);
    state.characters.push(...imported);
    for(const character of imported)initializeImportedCharacterLight(character);
    normalizeCharacterState(state);ensureCharacterPresentation();syncPlayerToActiveCharacter();
    const mishapTest = new URLSearchParams(location.search).get('mishap-test');
    if (['shred','balance'].includes(mishapTest)) {
      const wizard = state.characters.find(character => /wizard/i.test(character.className));
      applyHigherMishap(state, wizard, 'Antimagic Shell', mishapTest === 'shred' ? 12 : 10, { ...higherMishapContext(wizard), tier: 5 });
    }
    if (new URLSearchParams(location.search).get('underpass-test') === 'one') {
      const width = 21, height = 15;
      state.map = { ...state.map, width, height }; state.halls = []; state.decor = {};
      state.tiles = Array.from({ length: width * height }, (_, index) => {
        const x = index % width, y = Math.floor(index / width);
        const west = x >= 1 && x <= 4 && y >= 5 && y <= 9, east = x >= 16 && x <= 19 && y >= 5 && y <= 9;
        const floor = west || east || x === 10 && y >= 1 && y <= 13 || y === 2 && x >= 3 && x <= 17 ||
          (x === 3 || x === 17) && y >= 2 && y <= 7 || y === 7 && x >= 5 && x <= 15;
        return { x, y, type: floor ? 'floor' : 'wall', roomId: west ? 'underpass-west' : east ? 'underpass-east' : null,
          hallId: floor && !west && !east ? y === 7 && x >= 5 && x <= 15 ? 'underpass-review' : 'underpass-upper-loop' : null, meta: {} };
      });
      state.rooms = [{ id: 'underpass-west', x: 1, y: 5, width: 4, height: 5 }, { id: 'underpass-east', x: 16, y: 5, width: 4, height: 5 }];
      state.underpasses = [makeUnderpass('underpass-review', Array.from({ length: 9 }, (_, i) => ({ x: i + 6, y: 7 })),
        { x: 10, y: 7 }, [{ x: 5, y: 7 }, { x: 15, y: 7 }])];
      state.generation = { entranceRoomId: 'underpass-west', connectivityValid: true };
      state.entities = [{ id: 'underpass-stairs', type: 'stairs', subtype: 'up', x: 2, y: 7, roomId: 'underpass-west', routeId: '' }];
      const doorRng = new SeededRng(state.seed);
      for (const [x, y, roomId, side, hallId] of [[3, 4, 'underpass-west', 'north', 'underpass-upper-loop'],
        [17, 4, 'underpass-east', 'north', 'underpass-upper-loop'], [5, 7, 'underpass-west', 'east', 'underpass-review'],
        [15, 7, 'underpass-east', 'west', 'underpass-review']]) {
        const orientation = side === 'north' ? 'horizontal' : 'vertical';
        state.entities.push({ ...createDoorEntity(x, y, roomId, hallId, doorRng, orientation, side, side,
          orientation === 'vertical' ? 'north' : 'west', 'room'), doorState: 'closed', routeId: '' });
      }
      state.halls = ['underpass-upper-loop', 'underpass-review'].map(id => ({ id, fromRoomId: 'underpass-west', toRoomId: 'underpass-east',
        doors: state.entities.filter(entity => entity.hallId === id).map(entity => entity.id) }));
      state.decor.reviewed = [{ assetKey: 'statue-1x1-n', x: 2, y: 6, roomId: 'underpass-west' },
        { assetKey: 'statue-1x1-s', x: 18, y: 8, roomId: 'underpass-east' }].map(item => ({ ...item,
        gridWidthTiles: 1, gridHeightTiles: 1, rotationTurns: 0, routeId: '' }));
      const spots = [{ x: 10, y: 6, routeId: '' }, { x: 9, y: 7, routeId: 'underpass-review' }, { x: 3, y: 7, routeId: '' }];
      state.characters.forEach((character, i) => {
        Object.assign(character, spots[i], { roomId: getTileAt(spots[i].x, spots[i].y)?.roomId, conditions: {},
          lightSource: 'torch', lightRadius: 6, followEnabled: false });
        character.gear = [{ name: 'Torch', quantity: 1, totalUnits: 1, equipped: true, lit: true }];
        character.equipmentInitialized = true; character.raw.gear = structuredClone(character.gear);
      });
      state.activeCharacterId = state.characters[1].id; state.combat.active = false; state.encounterPrompt = null;
      state.wanderingMonsters.numerator = 0; syncPlayerToActiveCharacter();
    }
    if (new URLSearchParams(location.search).get('pit-tunnel-test') === 'one') {
      const width = 23, height = 13;
      state.map = { ...state.map, width, height }; state.halls = []; state.decor = {}; state.underpasses = [];
      state.rooms = [{ id: 'pit-west', x: 1, y: 3, width: 6, height: 7 }, { id: 'pit-east', x: 16, y: 3, width: 6, height: 7, pitAccessOnly: true }];
      state.tiles = Array.from({ length: width * height }, (_, i) => {
        const x = i % width, y = Math.floor(i / width), room = state.rooms.find(room => x >= room.x && y >= room.y && x < room.x + room.width && y < room.y + room.height);
        return { x, y, type: room ? 'floor' : 'wall', roomId: room?.id || null, meta: {} };
      });
      state.entities = [{ id: 'pit-tunnel-stairs', type: 'stairs', subtype: 'up', x: 2, y: 6, roomId: 'pit-west', routeId: '' },
        ...[{ id: 'pit-west-hole', x: 5, y: 6, width: 1, height: 1, roomId: 'pit-west' },
          { id: 'pit-east-hole', x: 17, y: 5, width: 2, height: 3, roomId: 'pit-east' }].map(pit => ({ ...pit,
            type: 'feature', subtype: 'pit', name: 'Pit', routeId: '', visible: true, revealed: true,
            cells: Array.from({ length: pit.width * pit.height }, (_, i) => ({ x: pit.x + i % pit.width, y: pit.y + Math.floor(i / pit.width) })) }))];
      const route = makePitTunnel(state, 'pit-review-tunnel', state.entities.filter(entity => entity.subtype === 'pit'),
        Array.from({ length: 13 }, (_, i) => ({ x: 5 + i, y: 6 })));
      for (const cell of route.lowerCells) if (getTileAt(cell.x, cell.y).type === 'wall') Object.assign(getTileAt(cell.x, cell.y), { type: 'floor', hallId: route.id });
      state.underpasses = [route]; state.generation = { entranceRoomId: 'pit-west', connectivityValid: true };
      state.characters.forEach((character, index) => {
        Object.assign(character, { x: 4, y: 5 + index, routeId: '', roomId: 'pit-west', conditions: {}, followEnabled: false });
        character.gear.push({ name: 'Rope', quantity: 1, totalUnits: 1, slots: 1 });
        const torch = character.gear.find(item => /torch/i.test(item.name)); if (torch) Object.assign(torch, { lit: true, equipped: true });
        character.lightSource = 'torch'; character.lightRadius = 6;
      });
      state.activeCharacterId = state.characters[1].id; state.combat.active = false; state.encounterPrompt = null;
      state.wanderingMonsters.numerator = 0; syncPlayerToActiveCharacter();
    }
    if (new URLSearchParams(location.search).get('pit-test') === 'one') {
      const width = 13, height = 11, roomId = 'pit-review-room';
      state.map = { ...state.map, width, height }; state.halls = []; state.decor = {}; state.underpasses = [];
      state.tiles = Array.from({ length: width * height }, (_, index) => {
        const x = index % width, y = Math.floor(index / width), floor = x > 0 && y > 0 && x < width - 1 && y < height - 1;
        return { x, y, type: floor ? 'floor' : 'wall', roomId: floor ? roomId : null, meta: {} };
      });
      state.rooms = [{ id: roomId, x: 1, y: 1, width: 11, height: 9 }]; state.generation = { entranceRoomId: roomId };
      state.entities = [{ id: 'pit-review-stairs', type: 'stairs', subtype: 'up', x: 2, y: 5, roomId },
        { id: 'pit-review-large', type: 'feature', subtype: 'pit', name: 'Pit', x: 6, y: 5, width: 2, height: 2, visible: true, revealed: true },
        { id: 'pit-review-hidden', type: 'trap', targetType: 'tile', name: 'Pit trap', trigger: 'Step', effect: '3d6 falling damage', x: 9, y: 5, roomId, visible: false, revealed: false },
        { id: 'pit-review-monster', type: 'monster', name: 'Orc', x: 6, y: 4, roomId, hp: 30, maxHp: 30, ac: 11, S: 2, D: 0,
          attack: '1 sword +2 (1d6)', visible: true, hostile: false, attitude: 'neutral', attitudeChecked: true, stealthState: { attempted: true, revealed: true } }];
      const spots = [[5, 5], [6, 5], [5, 4]];
      state.characters.forEach((character, index) => {
        Object.assign(character, { x: spots[index][0], y: spots[index][1], routeId: '', roomId, hp: 40, maxHitPoints: 40, conditions: {} });
        Object.assign(character.raw, { hp: 40, maxHitPoints: 40 });
      });
      state.characters[0].gear.push({ name: 'Rope', quantity: 1, totalUnits: 1, slots: 1 });
      state.characters[1].conditions = { sinkhole: 'pit-review-large', prone: true };
      state.activeCharacterId = state.characters[0].id; state.combat.active = false; state.encounterPrompt = null;
      state.wanderingMonsters.numerator = 0; syncPlayerToActiveCharacter();
    }
  }catch(error){setStatus(error.message);console.warn('Local test party was not loaded.',error);}
}

async function generateAndRender() {
  if (isSharedRoom()) return;
  const seed = Number(ui.seedInput.value || createRandomDungeonSeed());
  ui.seedInput.value = `${seed}`;
  const level = Number(ui.levelInput.value || 1);
  setStatus("Generating dungeon...");
  [shadowdarkContent, rulesData, organicAssetNames, innerWallAssetNames] = await Promise.all([
    loadShadowdarkContent(),
    loadRulesData(),
    loadOrganicAssets(),
    loadInnerWallAssets(),
    ensureSpellLibraryLoaded()
  ]);
  [trapTable, monsterTable, bossMonsterTable] = await Promise.all([
    loadTrapTable(),
    loadMonsterTableForLevel(level),
    loadBossMonsterTableForLevel(level)
  ]);
  state = generateDungeon(seed, level, {
    monsterTable,
    bossMonsterTable,
    trapTable,
    contentCatalog: shadowdarkContent,
    rulesData,
    spells: (await ensureSpellLibraryLoaded()).spells,
    organicAssets: organicAssetNames,
    innerWallAssets: innerWallAssetNames
  });
  normalizeCharacterState(state);
  normalizeWanderingChance(
    state,
    ui.wanderingNumerator?.value,
    ui.wanderingDenominator?.value
  );
  state.run.hasUserActivity = false;
  state.run.dirty = false;
  ensureCombatState();
  await loadLocalTestParty();
  recomputeVisibility(state);
  const sighting = processMonsterVisibilityChange();
  setupCanvasLayers(state);
  updatePanels();
  setActiveTab(activeTab);
  render();
  if (!sighting?.combatStarted && !sighting?.combatEnded) {
    setStatus(`Generated level ${level} map with seed ${seed}. Move with arrow keys.`);
  }
}

function startClock() {
  let followPending = false;
  window.setInterval(() => {
    if (!state) return;
    if(state.encounterPrompt || state.characters.some(character => character.pendingFall)){ensureTimers(state).lastTickAt=Date.now();return;}
    if (isSharedRoom()) {
      if (restInProgress(state)) {
        return;
      }
      const character = getExplicitActiveCharacter(state);
      if (!followPending && !sharedCommandPending && !isCombatActive() && canControlCharacter(character) &&
          advanceMarchingOrder(character, null, null, { previewOnly: true })) {
        followPending = true;
        void executeSharedCommand({ type: 'follow_step', character_id: character.id, ...currentMarchingCommand() })
          .catch(() => {}).finally(() => { followPending = false; });
      }
      return;
    }
    if (restInProgress(state)) {
      ensureTimers(state).lastTickAt = Date.now();
      if (progressPartyRest()) { updatePanels(); render(); }
      return;
    }
    const tickElapsed = Math.max(0, Date.now() - ensureTimers(state).lastTickAt);
    const result = syncElapsedTime(state);
    const encountersChanged=progressEncounterCreatures(tickElapsed);
    const effectsChanged = !isCombatActive() && progressWizardEffects(tickElapsed, { crawlingTurns: true });
    let changed = encountersChanged || effectsChanged;
    if(encountersChanged)processMonsterVisibilityChange();
    changed = advanceMarchingOrder(getExplicitActiveCharacter(state)) || changed;
    if (syncFloatingDiscFollowers()) { recomputeVisibility(state); markRunDirty(); changed = true; }
    if (result.crossedWanderingChecks) {
      processWanderingChecks(result.crossedWanderingChecks);
      changed = true;
    }
    if (result.expired) {
      setStatus(expireActiveLightFromTimer());
      changed = true;
    }
    if (processOutOfCombatDyingTick()) {
      changed = true;
    }
    if (!changed) {
      return;
    }
    render();
    updatePanels();
  }, 1000);
}

async function initialize() {
  void getAccountSession().then((session) => {
    accountSession = session;
    renderMultiplayerUi();
  }).catch(() => {});
  const assetsReady = preloadRendererAssets().then(() => true).catch((error) => {
    console.warn("Dungeon artwork failed to load; keeping the map black.", error);
    return false;
  });
  hookInputEvents();
  hookMapViewportInteractions();
  ui.seedInput.value = `${createRandomDungeonSeed()}`;
  updateHowToPlayLevel();
  updateControlSizing();
  syncSidebarWidth();
  syncBaseClassesOnlyToggleState(readBaseClassesOnlyPreference());
  if (document.fonts?.ready) {
    document.fonts.ready.then(syncSidebarWidth);
  }
  window.addEventListener("resize", syncSidebarWidth);
  window.addEventListener('resize', () => { if (state) requestAnimationFrame(() => { syncTurnCard(); clampTurnCard(); }); });
  startClock();
  const [artworkLoaded] = await Promise.all([assetsReady, generateAndRender()]);
  render();
  if (!artworkLoaded) setStatus("Dungeon artwork could not load. Reload the page to retry.");
  restoreRoomFromUrlIfPresent();
}

let serverContentReady = null;

export async function executeGameCommand(rawState, command) {
  if (!SERVER_RUNTIME) throw new Error("Game commands are processed by the server.");
  if (!rawState || !Array.isArray(rawState.tiles) || !Array.isArray(rawState.characters)) {
    throw new Error("The dungeon state is invalid.");
  }
  if (!serverContentReady) {
    serverContentReady = Promise.all([loadShadowdarkContent(), loadRulesData(), ensureSpellLibraryLoaded()])
      .then(([content, rules]) => { shadowdarkContent = content; rulesData = rules; });
  }
  await serverContentReady;
  state = hydrateDungeonState(rawState);
  restoreMonsterSpellStats(state,shadowdarkContent?.monsters);
  prepareEncounterState();
  serverMonsterTurns = null;
  serverFollowerFrames = new Map();
  lastDamageRoll = null;
  diceHistory = Array.isArray(state.rollHistory) ? state.rollHistory : [];
  ui.statusText.textContent = "";
  if(state.encounterPrompt&&!['reaction','normalize','tick','luck'].includes(command.type))throw new Error('Resolve the monster reaction first.');
  state.combat.autoRunning = false;
  state.run = state.run || {};
  const character = state.characters.find((item) => item.id === command.character_id);
  if (state.characters.some(member => member.pendingFall) && !['fall_response','tick','normalize'].includes(command.type)) throw new Error('Resolve the falling character\'s Feather Fall prompt first.');
  if (restInProgress(state) && !['rest_accept', 'rest_cancel', 'rest_alarm', 'tick', 'normalize', 'fall_response'].includes(command.type)) throw new Error('Cancel rest before taking an action.');
  const discInventoryCommands = new Set(['get', 'pickup', 'collect', 'equip', 'light', 'snuff', 'drop_gear', 'money', 'coin_adjust', 'coin_amount', 'reorder_gear']);
  if (isFloatingDisc(character) && !discInventoryCommands.has(command.type)) throw new Error('Floating Disc can only carry gear and equip lanterns; it cannot act or move independently.');
  const controller = inventoryController(character);
  if (isIncorporeal(character) && ['attack','attack_empty','attack_door','interact','pick_lock','break_door','light','get','pickup','collect','drop_gear','equip','steal','steal_take','wake'].includes(command.type)) throw new Error('Become corporeal before physically interacting.');
  if (isFloatingDisc(character) && (!canUseCharacterInventory(character) || isCombatActive() && !isCurrentCharacterTurn(character))) throw new Error("It is not this character's turn or its caster cannot act.");
  if (!pendingSpellAllowsCommand(controller, command.type, command.spell_name)) {
    throw new Error(pendingSpellMessage(controller));
  }
  let movementFrames = null;
  const utilityCommands = new Set(["normalize", "import", "bury", "dismiss", "edit_character", "tick", "rest_accept", "rest_cancel",'reaction','bury_corpse','reorder_gear','fall_response','revive','advance_choice','level_up','mishap_action','pit_action','descend','luck']);
  const teleportCommand = command.type === 'spell' && getSpellKey(command.spell_name) === 'misty step' || command.type === 'resolve_spell' && character?.pendingSpell?.spell === 'misty step';
  if (isTied(character) && !teleportCommand && !['end_turn','tick','normalize','luck'].includes(command.type) && !(command.type === 'pit_action' && ['escape','break'].includes(command.action))) throw new Error('Escape or break the rope before acting.');
  if (command.type === 'edit_character' && isCombatActive()) throw new Error('Character sheet edits are unavailable during combat; use the turn actions.');
  if (!utilityCommands.has(command.type)) {
    const dyingEnd = command.type === 'end_turn' && (isCharacterDying(character) || isRaving(character) || isSleeping(character, state) || character.conditions?.paralyzed) && isCurrentCharacterTurn(character);
    if (!character || !dyingEnd && !(isFloatingDisc(character) ? canUseCharacterInventory(character) : isCharacterAbleToAct(character))) throw new Error("This character cannot act.");
    if (isCombatActive() && !isCurrentCharacterTurn(character)) throw new Error("It is not this character's turn.");
  }
  if (character && command.type !== 'luck') {
    syncCharacterEquipmentDerivedStats(character);
    setActiveCharacter(state, character.id);
    syncPlayerToActiveCharacter();
  }
  if (['attack','attack_empty','attack_door','steal_target','steal_take','pit_action'].includes(command.type)) recomputeVisibility(state);
  if (command.type === "interact") {
    if (!Number.isInteger(command.x) || !Number.isInteger(command.y)) throw new Error("Invalid tile.");
    recomputeVisibility(state);
    const doorClick = getDoorClickContext(state, command.x, command.y, { characterId: character.id });
    if (doorClick?.message) throw new Error(doorClick.message);
  }
  if (command.type === 'spell' && getSpellKey(command.spell_name) === 'cure wounds') {
    validateCureWoundsTarget(state, character, command.target_id);
  }
  const actionCommands = new Set(["search", "disarm", "get", "leave", "interact", "pick_lock", "break_door", "spell", "light", "drop_gear", "pickup", "collect", "persuade", 'identify', 'read_scroll', 'read_wand']);
  if (command.type === 'interact' && getDoorAt(state, command.x, command.y) && !portalHeld(getDoorAt(state, command.x, command.y))) actionCommands.delete('interact');
  const resumingReadySpell = command.type === 'spell' && hasReadyOffensiveSpell(character) && character.pendingSpell.spell === getSpellKey(command.spell_name);
  const itemSpell = ['read_scroll', 'read_wand'].includes(command.type) && character.gear?.[command.gear_index]?.magic?.spellName;
  if (command.type === 'spell' && getSpellKey(command.spell_name) === 'knock' || command.type === 'resolve_spell' && character?.pendingSpell?.spell === 'knock' || itemSpell && getSpellKey(itemSpell) === 'knock')
    monsterTable = await loadMonsterTableForLevel(state.level);
  if (isCombatActive() && actionCommands.has(command.type) && !resumingReadySpell && !consumeCharacterCombatAction(character, { teleport: teleportCommand })) {
    throw new Error("This character has already acted this turn.");
  }
  switch (command.type) {
    case 'luck': performLuck(character); break;
    case 'descend':
      if (command.confirmed !== true) throw new Error('All connected players must confirm descent.');
      await descendDungeon(); break;
    case 'mishap_action': performMishapAction(character, command); break;
    case 'pit_action': performPitAction(character, command); break;
    case 'phase': performPhase(character); break;
    case 'attack_empty': attackEmptyTile(character, command.x, command.y, command.attack_index); break;
    case 'attack_door': attackDoor(character, command.entity_id, command.attack_index); break;
    case 'steal': beginSteal(character); break;
    case 'steal_target': resolveSteal(character, { targetId: command.target_id }); break;
    case 'steal_take': resolveSteal(character, { index: command.gear_index }); break;
    case 'steal_cancel': resolveSteal(character, { cancel: true }); break;
    case 'revive': performRevive(character); break;
    case 'stand': performStand(character); break;
    case 'wake': performWake(character, command.target_id); break;
    case "normalize":
      break;
    case 'reaction':
      if(typeof command.talk!=='boolean')throw new Error('Choose yes or no.');
      answerReaction(command.talk,command);break;
    case 'bury_corpse':
      if(isCombatActive())throw new Error('Wait until combat ends to bury a character.');
      buryCorpse(command.entity_id);break;
    case 'ancestry_invisibility':performHalflingInvisibility(character);break;
    case 'fall_response':
      if (!character?.pendingFall || command.attempt === true && !isCharacterAbleToAct(character)) throw new Error('This character cannot respond to a fall.');
      answerFall(character, command.attempt); break;
    case "move":
    case "move_batch": {
      if (isProne(character, state)) throw new Error('Stand up before moving.');
      const moves = command.type === "move_batch" ? command.moves : [{ dx: command.dx, dy: command.dy }];
      if (!Array.isArray(moves) || !moves.length || moves.length > 8) throw new Error("Choose 1 to 8 movement steps.");
      movementFrames = [{
        x: Number(character.x),
        y: Number(character.y),
        routeId: routeOf(state, character),
        roomId: character.roomId ?? getTileAt(Number(character.x), Number(character.y))?.roomId ?? null
      }];
      for (const move of moves) {
        const dx = move?.dx;
        const dy = move?.dy;
        if (!Number.isInteger(dx) || !Number.isInteger(dy) || Math.abs(dx) > 1 || Math.abs(dy) > 1 || (!dx && !dy)) {
          throw new Error("Choose an adjacent tile.");
        }
        if (!isCharacterAbleToAct(character) || (isCombatActive() && !isCurrentCharacterTurn(character))) break;
        if (!handleCombatMovement([dx, dy])) {
          const result = movePlayer(state, dx, dy, { deferVisibility: true });
          if (result.moved) {
            syncActiveCharacterToPlayer();
            recomputeVisibility(state);
            processMonsterVisibilityChange();
            advanceMarchingOrder(character, [dx, dy], command);
          }
          setStatus(result);
        }
        const previous = movementFrames.at(-1);
        if (Number(character.x) !== previous.x || Number(character.y) !== previous.y) {
          movementFrames.push({
            x: Number(character.x),
            y: Number(character.y),
            routeId: routeOf(state, character),
            roomId: character.roomId ?? getTileAt(Number(character.x), Number(character.y))?.roomId ?? null
          });
        }
      }
      break;
    }
    case 'follow_step':
      if (!isCombatActive()) advanceMarchingOrder(character, null, command);
      break;
    case "attack": {
      const monster = command.target_id ? state.characters.find(member => member.id === command.target_id) : getMonsterById(command.monster_id);
      if (command.target_id) {
        if (command.confirmed !== true || !monster || monster.id === character.id || isCharacterDead(monster)) throw new Error('Confirm attacking another living party member.');
      } else if (!monster || !canCharacterSeeMonster(character, monster,{includeInvisible:true})) throw new Error("That monster is not visible.");
      const attacks = getRenderableAttacks(character);
      const index = command.attack_index ?? 0;
      if (!Number.isInteger(index) || index < 0 || index >= attacks.length) throw new Error("Unknown attack.");
      const text = attacks[index];
      const parsed = parseAttackText(text);
      if (!isAttackEquipped(character, parsed)) throw new Error("Equip that weapon before attacking.");
      resolveCharacterAttackAgainstMonster(character, getCombatAttackFromParsedAttack(parsed, text), monster);
      break;
    }
    case "end_turn": endCurrentTurn(); break;
    case "search": performSearch(); break;
    case "stealth": performStealth(); break;
    case "get": performGet(); break;
    case "leave": performLeave(); break;
    case "disarm": {
      if (!command.entity_id) { performDisarm(); break; }
      const trap = getRoomTraps(state).find((entry) => entry.id === command.entity_id);
      if (!trap) throw new Error("That trap is not available here.");
      const context = getCharacterActionContext("disarm");
      setStatus(disarmTrap(state, trap.id, context.modifier, { doubleRoll: context.doubleRoll }));
      break;
    }
    case "interact": {
      const monster=state.entities.find(entity=>entity.type==='monster'&&sameRoute(state,entity,character)&&entity.x===command.x&&entity.y===command.y&&!entity.defeated);
      if(monster){
        if(!concealedMimic(monster))throw new Error('Choose an attack to attack a creature.');
        setStatus(collectLoot(state,monster.id));processMonsterVisibilityChange();break;
      }
      setStatus(interactAtDoor(command.x, command.y, character));
      processMonsterVisibilityChange();
      break;
    }
    case "pick_lock":
    case "break_door": {
      const action = command.type === "pick_lock" ? "pick" : "break";
      const context = getCharacterActionContext(action);
      setStatus(attemptLockedDoor(state, action, context.modifier, { doubleRoll: context.doubleRoll, disadvantage: context.disadvantage }));
      break;
    }
    case "spell": {
      const spell = findSpellRecord(command.spell_name);
      if (!spell || !getCharacterKnownSpellNames(character).some((name) => getSpellKey(name) === getSpellKey(spell)) || isCharacterSpellFailed(character, spell)) {
        throw new Error("This spell is not available to the character.");
      }
      performSpellCast(character, spell, command.target_id);
      break;
    }
    case 'resolve_spell':
      if (TIER_TWO_SPELLS.has(character.pendingSpell?.spell)) finishTierTwoSpell(character, { choice: command.choice, option: command.option, targetId: command.target_id, x: command.x, y: command.y, confirmed: command.confirmed === true, gearIndex: command.gear_index, dismiss: command.dismiss === true });
      else if (character.pendingSpell?.spell === 'light') finishLightSpell(character, { targetId: command.target_id, x: command.x, y: command.y });
      else if (FAITH_SPELLS.has(character.pendingSpell?.spell)||WIZARD_TIER_ONE.has(character.pendingSpell?.spell)||character.pendingSpell?.spell==='invisibility') finishFaithSpell(character, { choice: command.choice, targetId: command.target_id, x: command.x, y: command.y, dismiss: command.dismiss === true });
      else if (character.pendingSpell?.spell === 'magic missile') {
        if (typeof command.dismiss !== 'undefined' && typeof command.dismiss !== 'boolean') throw new Error('Invalid missile dismissal.');
        if (command.blind != null && typeof command.blind !== 'boolean') throw new Error('Invalid target selection.');
        resolveMagicMissile(character, { choice: command.choice, targetId: command.target_id, x: command.x, y: command.y, blind: command.blind === true, dismiss: command.dismiss === true });
      } else if (character.pendingSpell?.spell === 'burning hands') {
        if (typeof command.dismiss !== 'undefined' && typeof command.dismiss !== 'boolean') throw new Error('Invalid spell dismissal.');
        resolveBurningHands(character, { choice: command.choice, dismiss: command.dismiss === true });
      } else finishCriticalHealing(character, command.choice);
      break;
    case 'penance':
      performPenance(character, getSpellKey(command.spell_name || 'cure wounds'));
      break;
    case 'rest':
    case 'rest_accept':
    case 'rest_cancel':
      performRestAction(command.type, command);
      break;
    case 'rest_alarm': performRestAlarm(character); break;
    case "light":
      if (!["torch", "lantern"].includes(command.source)) throw new Error("Invalid light source.");
      if (command.gear_index != null && (!Number.isInteger(command.gear_index) || getGearLightSource(character.gear?.[command.gear_index]) !== command.source || character.gear[command.gear_index].lit)) throw new Error("Choose an unlit light source.");
      if (getLightAttemptFailure(command.source)) throw new Error(getLightAttemptFailure(command.source));
      if (ensureTimers(state).lightEverLit && !isCharacterInLiveLight(character)) {
        const check = rollCheck(getCharacterActionModifier(controller, "dex"), { disadvantage: !isThief(controller) });
        if (check.total < 12) { setStatus(`Light ${check.total} vs DC 12: failed.`); break; }
      }
      if (command.reset_timer != null && typeof command.reset_timer !== 'boolean') throw new Error('Invalid timer choice.');
      applyLightRequest(command.source, { extinguishOld: command.reset_timer === true, gearIndex: command.gear_index });
      break;
    case "equip":
      if (!Number.isInteger(command.gear_index) || typeof command.equipped !== "boolean" || (!handItemKind(character.gear?.[command.gear_index])&&!isArmorItem(character.gear?.[command.gear_index]))) throw new Error("Unknown equipment.");
      changeCharacterEquipment(character, command.gear_index, command.equipped);
      break;
    case 'reorder_gear':
      if(!character)throw new Error('Unknown character.');
      reorderCharacterGear(character,command.from_index,command.to_index);break;
    case 'identify':
    case 'drink_potion':
    case 'read_scroll':
    case 'read_wand':
    case 'learn_scroll':
      performMagicGearAction(command.type, character, command.gear_index, command.target_id); break;
    case 'sell_treasure':
      sellCharacterTreasure(character, command.items, command.coins); break;
    case 'advance_choice':
      applyAdvancementChoice(character, command.event_id, command.task_id, command.value); break;
    case 'level_up':
      startCharacterLevelUp(character); break;
    case "buy_gear": {
      const item = STARTING_ROOM_SHOP_ITEMS.find(item => item.id === command.item_id);
      if (!item || !isCharacterInStartingRoom(character)) throw new Error("Buy supplies only in the starting room.");
      buyStartingRoomShopItem(character, item);
      break;
    }
    case "snuff":
      if (isFloatingDisc(character) && character.lightSource !== 'lantern') throw new Error('Floating Disc has no equipped lit lantern.');
      if (character.lightSource === "lantern") extinguishActiveLantern();
      else snuffActiveTorch();
      setStatus(`${character.name} extinguishes their light.`);
      break;
    case "guard":
      character.guarding = !character.guarding;
      setStatus(`${character.name} ${character.guarding ? "is guarding" : "stops guarding"}.`);
      break;
    case "drop_gear":
      if (!Number.isInteger(command.gear_index) || !character.gear?.[command.gear_index]) throw new Error("Unknown item.");
      setStatus(dropCharacterGear(character, command.gear_index));
      break;
    case "pickup": {
      const item = getRoomLoot(state).find((entry) => entry.id === command.entity_id);
      if (!item) throw new Error("That item is not available here.");
      setStatus(item.subtype === "dropped-equipment" ? pickupDroppedEquipment(item) : collectLoot(state, item.id));
      break;
    }
    case 'attack_treasure': {
      const item=state.entities.find(entity=>entity.id===command.entity_id&&entity.type==='treasure'&&!entity.collected);
      const attack=getRenderableAttacks(character).find(text=>isAttackEquipped(character,parseAttackText(text)));
      const parsed=attack&&getCombatAttackFromParsedAttack(parseAttackText(attack),attack);
      if(!item||!parsed||!canTargetAtRange(state,character,item,parsed.range?.maxRange||1))throw new Error('That treasure is not in attack range.');
      if(!consumeCharacterCombatAction(character))throw new Error('This character has already acted.');
      revealAfterOffense(character);setStatus('That does nothing.');break;
    }
    case "collect": setStatus(collectRoomLoot(state)); break;
    case "money":
      if (!["gold", "silver", "copper"].includes(command.key) || !Number.isInteger(command.amount) || command.amount < 0 || command.amount > getCharacterMoney(character, command.key) || getCharacterMoney(character, command.key) - command.amount > 10000) throw new Error("Drop at most 10,000 owned coins at a time.");
      updateCharacterMoneyField(character, command.key, command.amount);
      setStatus(`${character.name} drops coins.`);
      break;
    case "coin_adjust":
    case "coin_amount": {
      const loot = getRoomLoot(state).find((entry) => entry.id === command.entity_id && entry.coinBreakdown);
      if (!loot) throw new Error("That coin pile is not available here.");
      if (command.type === "coin_adjust") {
        if (!["up", "down"].includes(command.direction)) throw new Error("Invalid coin movement.");
        adjustCoinFeature(loot, command.direction);
      } else {
        if (!Number.isInteger(command.amount) || command.amount < 0 || command.amount > 10000) throw new Error("Invalid coin amount.");
        setCoinFeatureAmount(loot, command.amount);
      }
      setStatus(`${character.name} rearranges the coin pile.`);
      break;
    }
    case "roll": {
      let label;
      if (typeof command.expression === "string") {
        const expression = normalizeDamageExpression(command.expression);
        const dice = [...expression.matchAll(/(\d*)d(\d+)/g)];
        if (expression.length > 80 || !/^\d+d\d+(?:[+\-](?:\d+d\d+|\d+))*(?:x\d+)?$/.test(expression)
          || [...expression.matchAll(/\d+/g)].some((match) => Number(match[0]) > 100)
          || dice.some((match) => Number(match[2]) < 2 || Number(match[1] || 1) < 1)
          || dice.reduce((sum, match) => sum + Number(match[1] || 1), 0) > 100) throw new Error("Invalid dice expression.");
        lastDamageRoll = rollDamageExpression(expression);
        label = expression;
      } else {
        if (![4, 6, 8, 10, 12, 20, 100].includes(command.sides) || !Number.isInteger(command.count) || command.count < 1 || command.count > 99 || !Number.isInteger(command.modifier) || Math.abs(command.modifier) > 99) throw new Error("Invalid dice roll.");
        lastDamageRoll = rollManualDie(command.sides, command.count, command.modifier);
        label = `${command.count}d${command.sides}${formatSignedModifier(command.modifier)}`;
      }
      setStatus(`${character.name} rolls ${label}: ${lastDamageRoll.total}.`);
      pushDiceHistory('Roll', ui.statusText.textContent, character.id);
      pushCombatLog(ui.statusText.textContent);
      break;
    }
    case "persuade": {
      const monster = getMonsterById(command.monster_id);
      if (!monster || !canCharacterSeeMonster(character, monster) || !monsterAllowsDiplomacy(monster)) throw new Error("That monster cannot be approached.");
      persuadeMonster(monster);
      break;
    }
    case "import": {
      const imported = extractShadowdarkCharacters(JSON.stringify(command.character_json));
      if (imported.length !== 1 || !floatingDiscSlotsAvailable(state)) throw new Error("Import one character; the dungeon holds at most 16, including reserved spell slots.");
      const added = imported[0];
      if (command.fresh_import === true) initializeImportChoices(added);
      added.id = command.new_character_id;
      added.raw = added.raw || {};
      delete added.raw.owner_member_id;
      added.partyAssetShareCopper = 0;
      added.raw.partyAssetShareCopper = 0;
      placeCharactersNearStartingStairs([added]);
      state.characters.push(added);
      initializeImportedCharacterLight(added);
      queueCharactersForNextCombatRound([added]);
      setStatus(`${added.name} joins the dungeon.`);
      break;
    }
    case "bury":
    case "dismiss":
      if (!character) throw new Error("Unknown character.");
      if(command.type==='dismiss'&&character.companion?.kind==='doppelganger'){betrayDoppelganger(character);break;}
      if (command.type === "bury" && !isCharacterDead(character)) throw new Error("Only dead characters can be buried.");
      if(command.type==='bury')state.entities=state.entities.filter(entity=>entity.characterCorpse?.id!==character.id);
      if (command.type === "dismiss" && !isCharacterInStartingRoom(character)) throw new Error("Living characters can only be dismissed in the starting room.");
      state.characters = state.characters.filter((item) => item.id !== character.id);
      state.combat.turnOrder = state.combat.turnOrder.filter((entry) => entry.id !== character.id);
      state.combat.playerOrderIds = state.combat.playerOrderIds.filter((id) => id !== character.id);
      state.combat.pendingPlayerIds = state.combat.pendingPlayerIds.filter((id) => id !== character.id);
      state.combat.turnIndex = Math.min(state.combat.turnIndex, Math.max(0, state.combat.turnOrder.length - 1));
      removeDeadCharactersFromCombat();
      setStatus(`${character.name} has been ${command.type === "bury" ? "buried" : "dismissed"}.`);
      break;
    case "edit_character": {
      if (!character || !command.character_json || Array.isArray(command.character_json)) throw new Error("Invalid character edit.");
      if(character.companion)throw new Error('Companion statistics are fixed; use equipment and turn actions.');
      const editable = ["name", "ancestry", "className", "level", "alignment", "background", "deity", "title", "stats", "hp", "maxHitPoints", "armorClass", "gear", "gold", "silver", "copper", "xp", "XP", "talents", "spells", "attacks", "raw", "colorId", "color", "ammo"];
      const protectedRaw = { id: character.id, dead: character.dead, slain: character.slain, dyingRounds: character.dyingRounds };
      for (const key of editable) {
        if (Object.hasOwn(command.character_json, key)) character[key] = structuredClone(command.character_json[key]);
      }
      character.raw = { ...(character.raw || {}), ...protectedRaw };
      if (isCharacterDead(character)) character.hp = 0;
      refreshCharacterViews(character);
      setStatus(`${character.name}'s sheet was updated.`);
      break;
    }
    case "tick": {
      if(state.encounterPrompt || state.characters.some(character => character.pendingFall)){ensureTimers(state).lastTickAt=Date.now();break;}
      if (restInProgress(state)) {
        if (state.rest.phase === 'sleeping') {
          monsterTable = await loadMonsterTableForLevel(state.level);
          progressPartyRest();
        }
        ensureTimers(state).lastTickAt = Date.now();
        break;
      }
      if (getCurrentCombatEntry()?.type === "monster") startCurrentCombatTurn();
      const elapsed = Math.max(0, Math.min(15000, Number(command.elapsed_ms) || 0));
      progressEncounterCreatures(elapsed);
      state.timers.lastTickAt = Date.now() - elapsed;
      const result = syncElapsedTime(state);
      if (!isCombatActive()) {
        if (state.characters.some(character => hasWizardEffect(character, 'screaming'))) monsterTable = await loadMonsterTableForLevel(state.level);
        progressWizardEffects(elapsed, { crawlingTurns: true });
        syncFloatingDiscFollowers();
      }
      if (result.crossedWanderingChecks) {
        monsterTable = await loadMonsterTableForLevel(state.level);
        processWanderingChecks(result.crossedWanderingChecks);
      }
      if (result.expired) setStatus(expireActiveLightFromTimer());
      lastDyingAutoTickAt = Date.now() - elapsed;
      processOutOfCombatDyingTick();
      break;
    }
    default: throw new Error("Unknown game command.");
  }
  if (movementFrames?.length > 1 && typeof command.motion_id === "string") {
    state.multiplayerMotions = Array.isArray(state.multiplayerMotions) ? state.multiplayerMotions.slice(-19) : [];
    state.multiplayerMotions.push({
      id: command.motion_id,
      actorId: typeof command.motion_actor_id === "string" ? command.motion_actor_id : null,
      characterId: character.id,
      frames: movementFrames,
      time: Date.now()
    });
  }
  if (serverFollowerFrames.size) {
    state.multiplayerMotions ||= [];
    const motionId = typeof command.motion_id === 'string' ? command.motion_id : `disc-tick-${Date.now()}`;
    let index = 0;
    for (const [characterId, frames] of serverFollowerFrames) {
      state.multiplayerMotions.push({ id: `${motionId.slice(0, 36)}:f:${index++}`, actorId: command.motion_actor_id,
        characterId, frames, time: Date.now() });
    }
    state.multiplayerMotions = state.multiplayerMotions.slice(-20);
  }
  normalizeCharacterState(state);
  syncAllCharacterEquipmentDerivedStats();
  for (const member of state.characters) if (member.dead || member.slain || Number(member.hp) <= 0) member.focusSpell = null;
  progressFloatingDiscTime(0);
  if (command.type !== "edit_character" && command.type !== "normalize" && command.type !== "import") {
    recomputeVisibility(state);
    processMonsterVisibilityChange();
  }
  if (command.type !== "normalize" && command.type !== "import" && command.type !== "edit_character") {
    for (let count = 0; count < 32; count += 1) {
      if (serverMonsterTurns) {
        const pending = serverMonsterTurns;
        await pending;
        if (serverMonsterTurns === pending) serverMonsterTurns = null;
      }
      const entry = getCurrentCombatEntry();
      const absentTurn = entry?.type === "character" && Array.isArray(command.online_character_ids) &&
        command.online_character_ids.length > 0 && !command.online_character_ids.includes(entry.id);
      if (!shouldAutoEndCurrentCharacterTurn() && !absentTurn) break;
      if (absentTurn) pushCombatLog(`${getCharacterNameById(entry.id) || "Character"} waits while their player is away.`);
      advanceCombatTurn();
    }
  }
  const message = ui.statusText.textContent || "";
  state.activity = Array.isArray(state.activity) ? state.activity.slice(-39) : [];
  if (message) state.activity.push({ message: message.slice(0, 2000), characterId: character?.id || null, time: Date.now() });
  state.combat.autoRunning = false;
  return { state_json: serializeDungeonState(state), message, dice: lastDamageRoll };
}

if (!SERVER_RUNTIME) initialize();

export { analyzeProject, slugify, ENGINE_VERSION } from "./analyze";
export type { AnalyzeOptions } from "./analyze";

export { buildFileIndex, discoverProjects, isProjectRoot } from "./discover";
export type { WalkOptions } from "./discover";

export {
  analyzeEcosystems,
  analyzeNpm,
  analyzePub,
  analyzePypi,
  analyzeGo,
  analyzeCargo,
  analyzeRubyGems,
  analyzeComposer,
} from "./ecosystems";
export { findDuplicateFamilies, normalizeName } from "./duplicates";
export type { ProjectFamily, FamilyMember } from "./duplicates";
export { fingerprint } from "./fingerprint";
export { computeLanguages, LANGUAGE_BY_EXTENSION } from "./languages";
export { computeHealth, applyEnrichment } from "./health";
export { detectDistributions } from "./distributions";
export { resolveLinks } from "./links";
export { readRunbook } from "./runbook";
export {
  readAgentsMd,
  lintAgentDoc,
  repairAgentDoc,
  estimateTokens,
  docHash,
  agentsMdHash,
  depVersions,
  readEnvKeys,
  renderPanomaBlock,
  upsertPanomaBlock,
  pickAgentDoc,
  composeBlockData,
  hasPanomaBlock,
  findPanomaBlock,
  AGENT_DOC_FILES,
  CLAUDE_BRIDGE,
  PANOMA_BLOCK_BEGIN,
  PANOMA_BLOCK_END,
} from "./agentsmd";
export type {
  AgentsMdReport,
  AgentsMdFile,
  AgentsMdFinding,
  AgentsMdOptions,
  LintFacts,
  EnvContract,
  DocTouch,
  PanomaBlockData,
  AgentAsks,
  CatalogMdContext,
} from "./agentsmd";
export {
  readProvenance,
  deduceIdentity,
  classifyOrigin,
  evidenceText,
  ORIGIN_EVIDENCE_CODES,
} from "./provenance";
export type {
  Provenance,
  ProjectOrigin,
  OriginKind,
  Identity,
  OriginEvidence,
  OriginEvidenceCode,
} from "./provenance";
export { readSummary, composeSummary, composedText } from "./summary";
export type { Summary, Composition, ProjectKind } from "./summary";
export type { Runbook, RunCommand, RuntimeNeed } from "./runbook";
export { findUnusedAssets } from "./assets";
export type { AssetReport, UnusedAsset } from "./assets";
export { identityCandidate } from "./identity";
export type { IdentityCandidate } from "./identity";
export { neutralizeInline, neutralizeUntrusted, untrustedFence, wrapUntrusted } from "./untrusted";
export type { UntrustedOrigin, UntrustedOptions } from "./untrusted";
export {
  MEMORY_CANONICAL_VERSION,
  MEMORY_CHANNELS,
  MEMORY_CONTRACT_VERSION,
  MEMORY_KINDS,
  MEMORY_OPERATIONS,
  MEMORY_UNIT_KINDS,
  MEMORY_RANKING_VERSION,
  MEMORY_RENDER_VERSION,
  RECEIPT_MARKER,
  TRANSPORT_PROFILES,
  canonicalHash,
  canonicalJson,
  checkReception,
  codePointLength,
  contentHashOf,
  contractIdIn,
  finalMessage,
  isMemoryChannel,
  isMemoryKind,
  isMemoryOperation,
  isMemoryUnitKind,
  isOpaqueId,
  isOpaqueToken,
  isRevision,
  packMemory,
  parseMemoryRequest,
  renderMemory,
  renderPredicate,
  renderUnit,
  sha256Hex,
  utf8Length,
} from "./memory-contract";
export type {
  MemoryApplicability,
  MemoryAuthority,
  MemoryChannel,
  MemoryCheck,
  MemoryContractV2,
  MemoryCoverage,
  MemoryDeliveryMode,
  MemoryEvidenceState,
  MemoryInvalid,
  MemoryItem,
  MemoryItemRef,
  MemoryKind,
  MemoryUnitKind,
  MemoryMode,
  MemoryOmission,
  MemoryOperation,
  MemoryPayload,
  MemoryReadRequestV2,
  MemoryRequestV2,
  MemoryScope,
  MemorySegment,
  MemorySnapshot,
  MemoryStatus,
  MemoryUnit,
  MemoryUnitManifest,
  PackInput,
  Packed,
  ReceptionCheck,
  ReceptionResult,
  RenderInput,
  Rendered,
  TransportProfile,
  TransportProfileId,
} from "./memory-contract";
export { redactSecrets, REDACTED } from "./redact";
export { HANDOFF_CLAUDE_RECORD_VERSION, HANDOFF_CODEX_ORIGINATOR, HANDOFF_PROVENANCE_PREFIX } from "./handoff-marker";
export {
  HOOKS_BRAND,
  asShellLine,
  hookIsOurs,
  mergePreToolUse,
  mergeStop,
  postCommitScript,
  removeStop,
} from "./hooks-install";
export {
  clearLease,
  leaseDir,
  leaseIntruder,
  leasePath,
  pidAlive,
  readLeases,
  writeLease,
} from "./db-lease";
export type { DatabaseLease } from "./db-lease";
export { findSecrets } from "./secrets";
export type { SecretReport, SecretFinding, Severity } from "./secrets";
export { redactQuote } from "./quotes";
export type { QuoteRedaction } from "./quotes";
export {
  TASTE_CAP,
  TASTE_FILE,
  MAX_TASTE_BYTES,
  /* The 'project' with which only the general is requested. See why the person publishing it needs it. */
  TASTE_GLOBAL_ONLY,
  TASTE_TOPICS,
  TasteFullError,
  parseTaste,
  readTaste,
  renderTaste,
  tasteDigest,
  /*
    A project's screen groups by theme like the summary that agents read, and in the same order:
    two arrangements for the same thing diverge on the first coined subject.
   */
  topicsOf,
  worstBlock,
  writeTaste,
} from "./taste";
export type { SeededTopic, TasteLine, TasteProfile, TasteTopic } from "./taste";
export { reviewProject, critiqueKey } from "./critic";
export type { CriticFinding, CriticKind, CriticReport } from "./critic";
export { readDesign } from "./design";
export type { DesignFingerprint, DesignSignal, DesignColor } from "./design";
export {
  MAX_FITTABLE_BYTES,
  MAX_SCREENSHOT_BYTES,
  SMALL_SCREENSHOT_WIDTH,
  ScreenshotError,
  imageTypeOf,
  readScreenshot,
} from "./screenshot";
export { MAX_FIT_PIXELS, fitScreenshot } from "./image";
export type { FittedShot, FitRefusal } from "./image";
export { SHOTS_DIR, openShots, readShots, shotsOpen, shotsPath } from "./deliveries";
export type { Shot, ShotsInbox } from "./deliveries";
export type { ImageType, Screenshot, ScreenshotProblem } from "./screenshot";
export { inventoryHistory, detectSignals } from "./history/index";
export { consentState } from "./history/consent";
export type { ConsentState } from "./history/consent";
export { hasReader, mineHistory, readableSources } from "./history/index";
export {
  isAllowed,
  publishesInferred,
  readConsent,
  setConsent,
  setInferredConsent,
} from "./history/index";
export type {
  HistorySource,
  HistorySourceId,
  MineOptions,
  MineResult,
  MineStats,
  Narrative,
  Reaction,
  VerdictSignal,
  TwinConsent,
  MineOutcome,
} from "./history/index";
export { measureDisk } from "./disk";
export type { DiskReport, ReclaimableDir } from "./disk";
export { findIcon, fallbackColor } from "./icon";
export { expandTilde, panomaHome, panomaPath, PANOMA_HOME_VAR } from "./home";
export { findExecutable, resolveExecutable, type Launch } from "./exec";
export { isNewerVersion } from "./versions";
export { normalizePypiName } from "./ecosystems/pypi-lockfiles";
export { restrictToOwner } from "./restrict";
export { avisoDeFormato, versionEnDisco, POSTGRES_DEL_PAQUETE } from "./base-format";
export { commitsPerDay, readGitInfo, workRisks } from "./git";
export type { WorkRisk, RiskLevel, RiskCode } from "./git";
export { RULES } from "./rules";
export type { Rule, Matcher } from "./rules";

export type * from "./types";

export { qualifyWithParent, qualifyWithFolder, readmeName } from "./readme-name";
export { SKIP_DIRS } from "./discover";
export { ensureAccessKey, isLoopbackHost, readAccessKey } from "./access";
export {
  agentKindAliases,
  canonicalAgentKind,
  MCP_FILE_MODE,
  mcpProjectTarget,
  mcpSnippet,
  mcpTarget,
  trackedByGit,
  type McpTarget,
  type McpTargetKind,
} from "./mcp-targets";
export {
  McpMergeError,
  McpTomlError,
  mergeMcp,
  mergeMcpToml,
  SERVER_NAME,
  type McpEntry,
  type McpMergeReason,
  type McpMergeResult,
} from "./mcp-merge";
export type { AccessKey } from "./access";
export {
  EDIT_MATCHER,
  LIFECYCLE_MATCHER,
  MANAGED_EVENTS,
  VERB_OF_EVENT,
  gitScanOrder,
  hookIdentityOf,
  isManagedVerb,
  managedCommand,
  managedHooks,
  mergeManagedHooks,
  removeManagedHooks,
  settingsText,
  shellArgv,
} from "./hooks-install";
export type { HookEvent, HookIdentity, ManagedHook, ManagedVerb } from "./hooks-install";
export {
  argvIsDurable,
  hookStateOf,
  isNpxPath,
  isPanomaMonorepo,
  monorepoBuiltCli,
  panomaEntryOnPath,
  panomaMonorepoRoot,
  resolveHookInvocation,
} from "./hook-invocation";
export type {
  DurableInvocation,
  HookEventState,
  HookInvocation,
  HookState,
  ResolveInvocationInput,
  UndurableInvocation,
} from "./hook-invocation";
export { grantFor, isGrantPurpose, setGrant } from "./history/index";
export type { ConsentGrant, GrantInput, GrantPurpose, GrantScope } from "./history/index";
export {
  RECEIPT_PARSER_VERSION,
  anchorHashAt,
  claudeCodeStreamKey,
  claudeCodeTranscriptPath,
  isClaudeCodeTranscript,
  readReceipts,
} from "./history/index";
export type {
  ReadEnd,
  ReadGap,
  ReadOptions,
  ReadResult,
  ReceiptEntrypoint,
  ReceiptEvent,
  ReceiptEventKind,
} from "./history/index";

// Delivery B: the fact readers of both harnesses and the owner's turns (see history/index.ts).
export {
  CLAUDE_FACTS_PARSER_VERSION,
  CODEX_FACTS_PARSER_VERSION,
  COMMAND_FAMILIES,
  COMMAND_FAMILY_NAMES,
  FACT_KINDS,
  HUMAN_TURN_CODE_POINTS,
  LOOKBACK_BYTES,
  MAX_FACT_PATHS,
  OUTSIDE,
  REDACTED_CREDENTIAL,
  classifyCommand,
  locateInterval,
  readCodexFacts,
  readCodexHumanTurns,
  readFacts,
  readHumanTurns,
  testResult,
} from "./history/index";
export type {
  CommandFamily,
  CommandFactPayload,
  CommitFactPayload,
  EditFactPayload,
  EditKind,
  FactEvent,
  FactKind,
  FactPayload,
  FactReadOptions,
  FactReadResult,
  FailureFactPayload,
  FailureKind,
  HumanTurn,
  HumanTurnOptions,
  HumanTurnResult,
  IntervalOptions,
  IntervalResult,
  LifecycleEvent,
  LifecycleFactPayload,
  ReadFactPayload,
  ReceiptSeenFactPayload,
  RecipientKey,
  TestOutcome,
  TestResultFactPayload,
} from "./history/index";

// Delivery C: the closed predicates, the pure check evaluator with the observed environment, and the case projection.
export {
  PREDICATE_LIMITS,
  PREDICATE_LEAF_KINDS,
  CHECK_RESULTS,
  MemoryShapeError,
  checkFactKey,
  validRelativePath,
  validatePredicate,
  validateExpression,
  evaluatePredicate,
  predicateChecks,
  applicability,
} from "./predicates";
export type {
  Tri,
  CheckResult,
  PredicateLeafKind,
  PredicateLeaf,
  PredicateNode,
  Predicate,
  CheckFact,
  PredicateFacts,
  CheckRef,
  Applicability,
} from "./predicates";
export {
  CHECK_PURPOSES,
  CHECK_KINDS,
  DEPENDENCY_ECOSYSTEMS,
  CHECK_LIMITS,
  CHECK_LITERAL_MAX,
  KEY_PATH_MAX,
  evaluateCheck,
  readGitHead,
  inspectedFingerprint,
  environmentIdOf,
  readEnvironment,
} from "./checks-eval";
export type {
  CheckPurpose,
  CheckKind,
  DependencyEcosystem,
  CheckLimits,
  JsonValue,
  ManifestScriptExpected,
  DirectDependencyExpected,
  StructuredKeyExpected,
  CheckDefinition,
  Check,
  InspectedState,
  InspectedFile,
  UnknownReason,
  VerdictReason,
  CheckReason,
  CheckEvaluation,
  Environment,
} from "./checks-eval";
export { CASE_HALVES, projectCase } from "./cases";
export type {
  DateLike,
  CaseTaskInput,
  CaseProjectInput,
  CaseEpisodeInput,
  CaseSessionInput,
  CaseCommitmentInput,
  CaseObservationInput,
  CaseRevisionInput,
  CaseInputs,
  CaseAsked,
  CaseDecided,
  CaseDeclared,
  CaseObservation,
  CaseChecked,
  MemoryCase,
} from "./cases";

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
export { neutralizeInline, wrapUntrusted } from "./untrusted";
export type { UntrustedOrigin, UntrustedOptions } from "./untrusted";
export { redactSecrets, REDACTED } from "./redact";
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
  MAX_SCREENSHOT_BYTES,
  SMALL_SCREENSHOT_WIDTH,
  ScreenshotError,
  imageTypeOf,
  readScreenshot,
} from "./screenshot";
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

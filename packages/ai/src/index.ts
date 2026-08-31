export { PROVIDERS, findProvider, providersByAuth } from "./providers";
export type { Provider, AuthType, ApiFamily, OauthConfig } from "./providers";

export {
  ConfigCorruptError,
  NoCredentialError,
  configPath,
  forgetCredential,
  maskKey,
  readConfig,
  resolveCredential,
  saveKey,
  saveToken,
  updateConfig,
  writeConfig,
} from "./credentials";
export type { AiConfig, ResolvedCredential } from "./credentials";

export {
  expired,
  exchangeCode,
  createChallenge,
  accountFrom,
  awaitCallback,
  redirectUri,
  refresh,
  authorizeUrl,
} from "./oauth";
export type { Challenge, OauthToken } from "./oauth";

export { completeWithCliAgent, detectCliAgents } from "./cli-agent";
export type { AgentAvailability } from "./cli-agent";

export { listModels } from "./models";

export { REDACTED, pointsElsewhere, checkBaseUrl, redact } from "./safety";

export { ATTEMPTS, callProvider, transportFailure } from "./transport";
export type { CallOptions } from "./transport";

export { complete, VisionUnsupportedError } from "./complete";
export type { CompleteImage, CompleteRequest, CompleteResult } from "./complete";

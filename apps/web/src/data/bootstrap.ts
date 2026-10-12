// T008 — the composition-root seam: the app boots its API client THROUGH
// data/ so the structural rule holds (only data/** imports api/ and chain/).
// Screens and the App import these — never the wire modules directly.

export type {
  ApiClient,
  ApiError,
  MeDto,
  ProfileDto,
  QuoteDto,
  VerificationStatusDto,
  VerificationTriggerDto,
} from "../api/client.js";
export { makeApiClient } from "../api/client.js";

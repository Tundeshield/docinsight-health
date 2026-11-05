// Shared types for every Firestore collection (PRD section 9).
// Used by the web app and Cloud Functions. Timestamps are Firestore Timestamps
// in the database; here they are typed as `TS` so both sides can plug in their own.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type TS = any;

export type Currency = "NGN" | "USD" | "XOF";
/** All money is an integer in the smallest unit (kobo for NGN) with a currency code. */
export interface Money {
  amount: number;
  currency: Currency;
}

// ---------- Plans and billing configuration ----------

export type PlanId = "clinic" | "hospital" | "group";
export type BillingCycle = "monthly" | "annual";

/** plans/{planId}. Prices and limits live here so they change without code changes. */
export interface Plan {
  id: PlanId;
  name: string;
  description: string;
  currency: Currency;
  priceMonthly: number; // smallest unit
  priceAnnual: number; // smallest unit (pay 10 months, get 12)
  quoted: boolean; // Group: "from" price, quoted by sales
  seatLimit: number | null; // null = unlimited
  siteLimit: number | null;
  docLimit: number | null;
  aiQuestionLimit: number | null; // per month; null = fair use
  extraSeatBlockSize: number; // 10
  extraSeatBlockPrice: number; // per month, smallest unit
  paystackPlanCodeMonthly?: string;
  paystackPlanCodeAnnual?: string;
  features: string[];
  order: number;
  active: boolean;
}

export interface SetupPackage {
  id: "standard" | "large";
  name: string;
  includes: string;
  pages: number;
  trainingSessions: number;
  price: number;
  currency: Currency;
}

/** config/billing */
export interface BillingConfig {
  setupPackages: SetupPackage[];
  extraPagePrice: number; // per page, smallest unit
  currency: Currency;
  pilotDays: number; // 60
  pilotDiscountPct: number; // 50
  paystackEnabled: boolean;
  bankTransfer: {
    accountName: string;
    bankName: string;
    accountNumber: string;
    note: string;
  };
  invoicePrefix: string;
  vatPct: number;
  companyName: string;
  companyAddress: string;
  companyRc: string;
  supportEmail: string;
  /** Usage warnings and soft blocks */
  warnAtPct: number; // 80
  /** AI cost table, micro-USD per million tokens, per model id */
  modelPrices: Record<string, { input: number; output: number }>;
}

/** config/platform */
export interface PlatformConfig {
  adminEmails: string[]; // verified accounts with these emails become platform super admins
  alertEmails: string[]; // "report a problem" and conflict alerts go here
  flags: Record<string, boolean>; // v2 feature flags
}

// ---------- Institutions (tenants) ----------

export type InstitutionStatus =
  | "pending_payment"
  | "active"
  | "past_due"
  | "restricted"
  | "suspended"
  | "cancelled";

export interface InstitutionSettings {
  phoneLogin: boolean;
  dataSaverDefault: boolean;
  hiddenHubCollections: string[];
  /** Owner opt-in: individual question logs visible to admins */
  questionLogOptIn: boolean;
  requireAdmin2fa: boolean;
  emailDigest: boolean;
}

/** institutions/{id} */
export interface Institution {
  id: string;
  name: string;
  logoRef: string | null;
  colour: string; // hex
  country: string; // ISO code, "NG"
  planId: PlanId;
  billingCycle: BillingCycle;
  status: InstitutionStatus;
  statusChangedAt: TS;
  /** End of the paid period. Null until first payment. */
  currentPeriodEnd: TS | null;
  pastDueSince: TS | null;
  cancelledAt: TS | null;
  remindersSent: number[]; // past-due reminder days already sent (1, 7, 14)
  seatsUsed: number;
  extraSeats: number; // in seats, multiples of the block size
  billingContact: { name: string; email: string; phone: string };
  emailDomains: string[]; // verified emails on these domains auto-join
  settings: InstitutionSettings;
  joinCode: string;
  discountPct: number;
  pilot: { startedAt: TS; endsAt: TS; discountPct: number } | null;
  setupPackageId: SetupPackage["id"] | null;
  corpusVersion: number; // bumps when searchable content changes
  createdBy: string;
  createdAt: TS;
  lastActivityAt: TS | null;
  paystack?: { customerCode?: string; subscriptionCode?: string; emailToken?: string };
}

/** institutions/{id}/sites/{siteId} */
export interface Site {
  id: string;
  name: string;
  address: string;
  createdAt: TS;
}

// ---------- People ----------

export type MemberRole = "owner" | "admin" | "editor" | "approver" | "staff" | "locum";
export const MANAGER_ROLES: MemberRole[] = ["owner", "admin"];
export type MemberStatus = "active" | "deactivated";
/** Derived from the institution's billing status and the member's role. Rules read it. */
export type MemberAccess = "full" | "read" | "admin_only" | "none";

/** institutions/{id}/members/{userId} */
export interface Member {
  userId: string;
  role: MemberRole;
  name: string;
  email: string;
  phone: string;
  jobTitle: string; // Doctor, Nurse, Pharmacist…
  department: string;
  /** Restricted spaces this person was added to by name */
  spaceIds: string[];
  status: MemberStatus;
  /** Locums and guests lose access at this time */
  expiresAt: TS | null;
  invitedBy: string | null;
  joinedAt: TS;
  lastActiveAt: TS | null;
  // ----- maintained by Cloud Functions, read by security rules -----
  access: MemberAccess;
  visibleSpaceIds: string[];
  editSpaceIds: string[];
  approveSpaceIds: string[];
  /** Unix seconds. Sessions that signed in before this are rejected (force sign-out). */
  signOutBefore: number;
}

/** users/{uid} */
export interface UserProfile {
  id: string;
  name: string;
  email: string;
  phone: string;
  institutionIds: string[];
  defaultInstitutionId: string | null;
  hubAccess: boolean; // true while any membership is in a paying institution
  lastActiveAt: TS | null;
  createdAt: TS;
}

/** users/{uid}/private/settings (written by the user) */
export interface UserSettings {
  dataSaver: boolean;
  emailDigest: boolean;
  pushEnabled: boolean;
}

/** institutions/{id}/invites/{token} */
export interface Invite {
  token: string;
  email: string | null;
  phone: string | null;
  name: string;
  role: MemberRole;
  jobTitle: string;
  department: string;
  spaceIds: string[];
  locumExpiresAt: TS | null;
  status: "pending" | "accepted" | "revoked";
  createdBy: string;
  createdAt: TS;
  expiresAt: TS; // the invite link itself
  sentVia: ("email" | "sms" | "link")[];
}

/** institutions/{id}/joinRequests/{uid} */
export interface JoinRequest {
  userId: string;
  name: string;
  email: string;
  phone: string;
  jobTitle: string;
  department: string;
  status: "pending" | "approved" | "declined";
  createdAt: TS;
  decidedBy: string | null;
  decidedAt: TS | null;
}

// ---------- Spaces and sections ----------

export type SpaceVisibility = "all" | "restricted";

/** institutions/{id}/spaces/{spaceId} */
export interface Space {
  id: string;
  siteId: string | null;
  name: string;
  icon: string;
  colour: string;
  description: string;
  visibility: SpaceVisibility;
  allowedUserIds: string[];
  allowedJobTitles: string[];
  editorIds: string[];
  approverIds: string[];
  approverNames: string[];
  requiresApproval: boolean;
  order: number;
  archived: boolean;
  template: string | null;
  createdAt: TS;
}

/** institutions/{id}/sections/{sectionId} */
export interface Section {
  id: string;
  spaceId: string;
  name: string;
  order: number;
  archived: boolean;
}

// ---------- Content ----------

export type ContentType = "file" | "page" | "checklist" | "link" | "image";
export type DocumentType =
  | "protocol"
  | "guideline"
  | "sop"
  | "equipment_manual"
  | "policy"
  | "form"
  | "formulary"
  | "billing"
  | "leaflet"
  | "other";
export type ContentStatus = "draft" | "in_review" | "approved" | "archived";
export type VersionStatus = "uploading" | "processing" | "draft" | "in_review" | "changes_requested" | "rejected" | "approved" | "superseded";
export type OcrStatus = "not_needed" | "pending" | "processing" | "done" | "needs_review" | "failed";

/** institutions/{id}/content/{contentId} (hubContent/{id} has the same shape) */
export interface ContentItem {
  id: string;
  spaceId: string; // for hub content: the collection id
  sectionId: string | null;
  type: ContentType;
  title: string;
  description: string;
  ownerId: string;
  ownerName: string;
  documentType: DocumentType;
  tags: string[];
  language: string; // "en", "fr"
  status: ContentStatus; // status of the newest version
  /** True when an approved version is live for staff and AI */
  published: boolean;
  currentVersionId: string | null; // latest approved
  currentVersionNumber: number | null;
  latestVersionId: string | null; // newest of any status
  versionCount: number;
  effectiveDate: string | null; // YYYY-MM-DD
  reviewDate: string | null; // YYYY-MM-DD
  reviewRemindersSent: number[]; // 30, 7
  mustRead: boolean;
  mustReadVersionId: string | null;
  // Shown to staff without reading versions:
  pageCount: number;
  approvedByName: string | null;
  approvedAt: TS | null;
  url: string | null; // for links
  source: "hospital" | "hub";
  // Hub only
  sourceName?: string;
  publicationDate?: string;
  originalUrl?: string;
  createdAt: TS;
  updatedAt: TS;
}

/** institutions/{id}/content/{cid}/versions/{vid} */
export interface ContentVersion {
  id: string;
  number: number;
  status: VersionStatus;
  fileRef: string | null; // original upload path
  fileName: string | null;
  mime: string | null;
  sizeBytes: number;
  pageCount: number;
  pageLabels: string[]; // "1", "2"… or "Part 1" for DOCX
  ocrStatus: OcrStatus;
  ocrConfidence: number | null; // average 0..1 over OCR pages
  ocrPages: number[]; // pages that needed OCR
  lowConfidencePages: number[];
  checkedPages: number[]; // low-confidence pages a person has checked
  processingError: string | null;
  processedPages: number;
  body: string | null; // markdown for in-app pages
  checklist: { text: string }[] | null;
  url: string | null;
  changeNote: string;
  createdBy: string;
  createdByName: string;
  createdAt: TS;
  submittedBy: string | null;
  submittedAt: TS | null;
  reviewComment: string | null;
  reviewedBy: string | null;
  reviewedAt: TS | null;
  approvedBy: string | null;
  approvedByName: string | null;
  approvedAt: TS | null;
  active: boolean; // the live version for staff and AI
  chunkCount: number;
}

/** Stored in Storage as text.json beside the page images */
export interface PageText {
  n: number;
  label: string;
  text: string; // cleaned, markdown-ish (headings, lists, tables)
  ocr: boolean;
  confidence: number | null;
  edited: boolean; // corrected by a person
}

/** institutions/{id}/chunks/{chunkId} (hubChunks/{id} has the same shape) */
export interface Chunk {
  id: string;
  contentId: string;
  versionId: string;
  spaceId: string; // hub: collection id
  sectionId: string | null;
  title: string;
  versionNumber: number;
  documentType: DocumentType;
  pages: [number, number];
  pageLabels: [string, string];
  headingPath: string;
  text: string;
  wordCount: number;
  ocr: boolean;
  embedding: unknown; // Firestore vector
  active: boolean;
  source: "hospital" | "hub";
  effectiveDate: string | null;
  language: string;
  createdAt: TS;
}

// ---------- Engagement ----------

/** institutions/{id}/acknowledgements/{contentId_versionId_userId} */
export interface Acknowledgement {
  contentId: string;
  versionId: string;
  userId: string;
  userName: string;
  jobTitle: string;
  acknowledgedAt: TS;
}

/** institutions/{id}/updates/{updateId} */
export interface Update {
  id: string;
  kind: "published" | "updated";
  contentId: string;
  versionId: string;
  versionNumber: number;
  title: string;
  spaceId: string;
  spaceName: string;
  changeNote: string;
  mustRead: boolean;
  recipientCount: number;
  at: TS;
}

/** institutions/{id}/members/{uid}/inbox/{updateId} */
export interface InboxItem {
  updateId: string;
  contentId: string;
  versionId: string;
  title: string;
  spaceName: string;
  kind: Update["kind"];
  changeNote: string;
  mustRead: boolean;
  read: boolean;
  acknowledgedAt: TS | null;
  at: TS;
}

/** institutions/{id}/notifications/{id} */
export interface NotificationRecord {
  id: string;
  type: "update" | "must_read_reminder" | "review_reminder" | "billing_reminder" | "approval_request" | "approval_decision" | "report" | "conflict";
  contentId: string | null;
  recipients: string[];
  channels: ("push" | "email" | "in_app")[];
  sentAt: TS;
}

// ---------- AI ----------

export type AnswerStatus = "answered" | "not_found" | "off_topic" | "blocked" | "error";

export interface Citation {
  n: number;
  chunkId: string;
  contentId: string;
  versionId: string;
  title: string;
  versionNumber: number;
  pages: [number, number];
  pageLabel: string;
  spaceId: string;
  spaceName: string;
  label: "Hospital protocol" | "National guidance";
  source: "hospital" | "hub";
  quote: string;
}

/** institutions/{id}/questions/{qid} */
export interface QuestionRecord {
  id: string;
  userId: string;
  question: string;
  retrievedChunkIds: string[];
  answer: string;
  citations: Citation[];
  status: AnswerStatus;
  conflict: { a: string; b: string } | null;
  topic: string;
  feedback: { rating: "up" | "down" | null; reportedAt: TS | null; note: string | null } | null;
  cached: boolean;
  tokens: { input: number; output: number; costMicros: number };
  hiddenByUser: boolean;
  createdAt: TS;
}

/** institutions/{id}/usage/{yyyy-mm} */
export interface UsageMonth {
  questions: number;
  notFound: number;
  searches: number;
  ocrPages: number;
  embeddedChunks: number;
  inputTokens: number;
  outputTokens: number;
  costMicros: number; // micro-USD
}

/** institutions/{id}/events/{id}: raw usage events for analytics */
export interface UsageEvent {
  type: "view" | "search" | "ask" | "signin";
  userId: string;
  contentId: string | null;
  query: string | null;
  at: TS;
}

// ---------- Billing ----------

export interface InvoiceLine {
  description: string;
  quantity: number;
  unitAmount: number;
  amount: number;
}

/** institutions/{id}/invoices/{id} */
export interface Invoice {
  id: string;
  number: string;
  kind: "subscription" | "setup" | "seats" | "pages" | "pilot" | "mixed";
  amount: number; // total, smallest unit
  currency: Currency;
  lines: InvoiceLine[];
  period: { start: TS; end: TS } | null;
  planId: PlanId | null;
  cycle: BillingCycle | null;
  /** Extends access to this date once paid */
  extendsTo: TS | null;
  method: "paystack" | "bank_transfer" | null;
  status: "open" | "paid" | "void";
  paystackRef: string | null;
  issuedAt: TS;
  dueAt: TS;
  paidAt: TS | null;
  confirmedBy: string | null;
  pdfRef: string | null;
  receiptRef: string | null;
}

// ---------- Audit ----------

export type AuditAction =
  | "signin"
  | "institution.create" | "institution.update" | "institution.status"
  | "site.create" | "site.update"
  | "space.create" | "space.update" | "space.archive"
  | "section.create" | "section.update" | "section.archive"
  | "member.invite" | "member.join" | "member.update" | "member.remove" | "member.signout"
  | "content.create" | "content.update" | "content.archive" | "content.must_read"
  | "version.upload" | "version.submit" | "version.approve" | "version.reject" | "version.changes_requested" | "version.publish" | "version.pages_corrected"
  | "acknowledge"
  | "billing.plan" | "billing.invoice" | "billing.payment" | "billing.discount" | "billing.pilot"
  | "settings.update" | "export";

/** institutions/{id}/auditLog/{id} */
export interface AuditEntry {
  id: string;
  actorId: string;
  actorName: string;
  action: AuditAction;
  target: { type: string; id: string; title?: string };
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  at: TS;
}

// ---------- Hub and platform ----------

/** hubCollections/{id} */
export interface HubCollection {
  id: string;
  name: string;
  description: string;
  order: number;
  archived: boolean;
}

/** digitisationJobs/{id} */
export interface DigitisationJob {
  id: string;
  institutionId: string; // "hub" for hub content
  institutionName: string;
  contentId: string;
  versionId: string;
  title: string;
  pagesReceived: number;
  pagesOcrd: number;
  pagesChecked: number;
  lowConfidencePages: number[];
  status: "received" | "ocr" | "checking" | "ready" | "published" | "failed";
  assignee: string | null;
  createdAt: TS;
  updatedAt: TS;
}

/** platformAdmins/{uid} */
export interface PlatformAdmin {
  email: string;
  grantedAt: TS;
}

// Launch configuration from the PRD. These are only the *defaults* written to
// Firestore on first deploy; after that, prices and limits are edited in
// Firestore (plans/*, config/billing) without code changes.
import type { BillingConfig, Plan, PlatformConfig } from "./types";

const naira = (n: number) => n * 100; // to kobo

export const DEFAULT_PLANS: Plan[] = [
  {
    id: "clinic",
    name: "Clinic",
    description: "Specialist clinics, diagnostic centres and small hospitals",
    currency: "NGN",
    priceMonthly: naira(60_000),
    priceAnnual: naira(60_000 * 10),
    quoted: false,
    seatLimit: 30,
    siteLimit: 1,
    docLimit: 500,
    aiQuestionLimit: 1_500,
    extraSeatBlockSize: 10,
    extraSeatBlockPrice: naira(15_000),
    features: ["Up to 30 staff", "1 site", "Up to 500 documents", "1,500 AI questions a month", "Knowledge Hub", "Must-read tracking"],
    order: 1,
    active: true,
  },
  {
    id: "hospital",
    name: "Hospital",
    description: "Mid-size private hospitals",
    currency: "NGN",
    priceMonthly: naira(200_000),
    priceAnnual: naira(200_000 * 10),
    quoted: false,
    seatLimit: 200,
    siteLimit: 1,
    docLimit: 3_000,
    aiQuestionLimit: 10_000,
    extraSeatBlockSize: 10,
    extraSeatBlockPrice: naira(10_000),
    features: ["Up to 200 staff", "1 site", "Up to 3,000 documents", "10,000 AI questions a month", "Knowledge Hub", "Must-read tracking", "Analytics"],
    order: 2,
    active: true,
  },
  {
    id: "group",
    name: "Group",
    description: "Hospital groups and large hospitals",
    currency: "NGN",
    priceMonthly: naira(600_000),
    priceAnnual: naira(600_000 * 10),
    quoted: true,
    seatLimit: null,
    siteLimit: null,
    docLimit: null,
    aiQuestionLimit: null,
    extraSeatBlockSize: 10,
    extraSeatBlockPrice: 0,
    features: ["Unlimited staff", "Multiple sites", "Unlimited documents", "Fair-use AI questions", "Two-factor login for admins", "Priority onboarding"],
    order: 3,
    active: true,
  },
];

export const DEFAULT_BILLING_CONFIG: BillingConfig = {
  setupPackages: [
    { id: "standard", name: "Standard setup", includes: "Up to 300 pages digitised, spaces structured, 1 training session", pages: 300, trainingSessions: 1, price: naira(150_000), currency: "NGN" },
    { id: "large", name: "Large setup", includes: "Up to 1,500 pages, department-by-department rollout, 3 training sessions", pages: 1_500, trainingSessions: 3, price: naira(450_000), currency: "NGN" },
  ],
  extraPagePrice: naira(250),
  currency: "NGN",
  pilotDays: 60,
  pilotDiscountPct: 50,
  paystackEnabled: false,
  bankTransfer: {
    accountName: "Avelon Health Technologies Limited",
    bankName: "To be confirmed",
    accountNumber: "To be confirmed",
    note: "Use the invoice number as the payment reference.",
  },
  invoicePrefix: "DIH",
  vatPct: 0,
  companyName: "Avelon Health Technologies Limited",
  companyAddress: "Lagos, Nigeria",
  companyRc: "RC 8342636",
  supportEmail: "",
  warnAtPct: 80,
  modelPrices: {
    // micro-USD per million tokens. Edit in Firestore when prices change.
    "claude-sonnet-5-5": { input: 3_000_000, output: 15_000_000 },
    "claude-haiku-5-5": { input: 1_000_000, output: 5_000_000 },
  },
};

export const DEFAULT_PLATFORM_CONFIG: PlatformConfig = {
  adminEmails: ["tundeshield@gmail.com"],
  alertEmails: ["tundeshield@gmail.com"],
  flags: {
    whatsapp: false,
    nativeApps: false,
    rotas: false,
    formulary: false,
    education: false,
    leaflets: false,
    french: false,
    sso: false,
  },
};

export interface SpaceTemplate {
  key: string;
  name: string;
  icon: string;
  colour: string;
  sections: string[];
  requiresApproval: boolean;
  visibility: "all" | "restricted";
  allowedJobTitles: string[];
}

export const SPACE_TEMPLATES: SpaceTemplate[] = [
  { key: "hospital-wide", name: "Hospital-wide", icon: "building", colour: "#12302A", sections: ["Policies", "Protocols", "Forms"], requiresApproval: true, visibility: "all", allowedJobTitles: [] },
  { key: "emergency", name: "Emergency", icon: "siren", colour: "#B4441C", sections: ["Protocols", "SOPs", "Equipment manuals", "Forms"], requiresApproval: true, visibility: "all", allowedJobTitles: [] },
  { key: "theatre", name: "Theatre", icon: "scissors", colour: "#7446BF", sections: ["Protocols", "SOPs", "Equipment manuals", "Checklists"], requiresApproval: true, visibility: "all", allowedJobTitles: [] },
  { key: "nursing", name: "Nursing", icon: "heart-pulse", colour: "#0E7A68", sections: ["Protocols", "SOPs", "Forms"], requiresApproval: true, visibility: "all", allowedJobTitles: [] },
  { key: "maternity", name: "Maternity", icon: "baby", colour: "#C2417A", sections: ["Protocols", "SOPs", "Forms"], requiresApproval: true, visibility: "all", allowedJobTitles: [] },
  { key: "pharmacy", name: "Pharmacy", icon: "pill", colour: "#2E55D0", sections: ["Formulary", "Medicines policies", "SOPs"], requiresApproval: true, visibility: "all", allowedJobTitles: [] },
  { key: "lab", name: "Laboratory", icon: "flask", colour: "#4B6175", sections: ["SOPs", "Sample handling", "Equipment manuals"], requiresApproval: true, visibility: "all", allowedJobTitles: [] },
  { key: "radiology", name: "Radiology", icon: "scan", colour: "#4B6175", sections: ["SOPs", "Protocols", "Equipment manuals"], requiresApproval: true, visibility: "all", allowedJobTitles: [] },
  { key: "biomedical", name: "Biomedical", icon: "wrench", colour: "#2E55D0", sections: ["Equipment manuals", "Maintenance SOPs", "Fault reporting"], requiresApproval: true, visibility: "all", allowedJobTitles: [] },
  { key: "billing", name: "Billing", icon: "receipt", colour: "#A85A12", sections: ["HMO rules", "NHIA", "Billing SOPs"], requiresApproval: false, visibility: "restricted", allowedJobTitles: ["Billing officer", "Front desk", "Administrator"] },
  { key: "hr", name: "HR", icon: "users", colour: "#A85A12", sections: ["Policies", "Forms", "Onboarding"], requiresApproval: false, visibility: "all", allowedJobTitles: [] },
];

export const JOB_TITLES = [
  "Doctor", "House officer", "Resident", "Consultant", "Nurse", "Midwife", "Pharmacist",
  "Lab scientist", "Radiographer", "Biomedical technician", "Billing officer", "Front desk",
  "Administrator", "Other",
];

export const DOCUMENT_TYPES: { id: import("./types").DocumentType; label: string }[] = [
  { id: "protocol", label: "Protocol" },
  { id: "guideline", label: "Guideline" },
  { id: "sop", label: "SOP" },
  { id: "equipment_manual", label: "Equipment manual" },
  { id: "policy", label: "Policy" },
  { id: "form", label: "Form" },
  { id: "formulary", label: "Formulary" },
  { id: "billing", label: "Billing rule" },
  { id: "leaflet", label: "Patient leaflet" },
  { id: "other", label: "Other" },
];

export const NOT_FOUND_MESSAGE = "This is not covered in your hospital's documents or the Knowledge Hub.";
export const OFF_TOPIC_MESSAGE = "I can only answer questions about your hospital's documents and the Knowledge Hub.";
export const ANSWER_FOOTER = "Supports, does not replace, clinical judgement. Check the source.";

/** Firestore region for every resource; documented in the security pack. */
export const REGION = "europe-west1";

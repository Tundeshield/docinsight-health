export const CATS = {
  protocol: { label: "Protocols & SOPs", one: "Protocol or SOP", hint: "Clinical guidelines, ward procedures" },
  equipment: { label: "Equipment manuals", one: "Equipment manual", hint: "Operator or service manuals" },
  policy: { label: "Policies & regulation", one: "Policy or regulation", hint: "Hospital policy, HEFAMAA, NHIA" },
  billing: { label: "Insurance & billing", one: "Insurance or billing", hint: "HMO rules, tariffs, coding" },
  system: { label: "Software & systems", one: "Software or system guide", hint: "EHR, laboratory, pharmacy systems" }
};
export const catOf = (s) => (CATS[s?.category] ? s.category : "protocol");
export const ROLES = [
  ["nurse or midwife", "Nurse or midwife"], ["doctor", "Doctor"], ["biomedical engineer or technician", "Biomedical engineer"],
  ["pharmacist", "Pharmacist"], ["admin, front desk or billing staff", "Admin or billing"], ["member of staff", "Other staff"]
];
export const TEAM_ROLES = { owner: "Owner", manager: "Library manager", staff: "Staff" };
export const ORG_TYPES = [
  ["private_hospital", "Private hospital"], ["clinic", "Clinic"], ["teaching_hospital", "Teaching hospital"], ["public_hospital", "Public hospital"],
  ["diagnostic_centre", "Diagnostic centre"], ["hmo", "HMO"], ["equipment_distributor", "Medical equipment distributor"], ["other", "Other"]
];
export const fmtDate = (d) => { try { return new Date(d + "T12:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }); } catch { return d; } };
export const isOverdue = (reviewDate) => !!reviewDate && new Date(reviewDate + "T23:59:59") < new Date();

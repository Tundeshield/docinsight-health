// Dummy protocols for the Demo Specialist Hospital. Written for testing only: drug names are
// fictional so nothing here can be mistaken for real dosing guidance.
export const DEMO_BANNER = "> DEMO DOCUMENT for testing DocInsight. Fictional content: not for clinical use.";

export const DEMO_DOCS: { space: string; section: string; title: string; documentType: string; reviewInDays: number; mustRead?: boolean; language?: string; body: string }[] = [
  {
    space: "emergency", section: "Protocols", title: "Adult sepsis screening and escalation", documentType: "protocol", reviewInDays: 300, mustRead: true,
    body: `# Adult sepsis screening and escalation\n\n${DEMO_BANNER}\n\n## 1. When to screen\nScreen every adult inpatient for sepsis when their NEWS2 score is 5 or more, when any single observation scores 3, or when staff suspect a new infection.\n\n## 2. Nurse actions\n1. Inform the responsible doctor within 15 minutes of a positive screen, using the SBAR handover format.\n2. Increase observations to every 30 minutes until the doctor has reviewed the patient.\n3. Record the time of the positive screen on the sepsis pathway form.\n\n## 3. Doctor actions in the first hour\nComplete these within one hour of a positive screen:\n1. Give oxygen to reach the patient's target saturation range.\n2. Take blood cultures before giving antibiotics, unless this would delay antibiotics by more than 45 minutes.\n3. Give the first-line intravenous antibiotic from the hospital antimicrobial formulary: Demomycin 1 g IV every 8 hours (fictional demo drug).\n4. Prescribe intravenous fluids if the patient is hypotensive or lactate is raised.\n5. Measure serum lactate.\n6. Start hourly urine output monitoring.\n\n## 4. Escalation to critical care\nCall the critical care outreach team on extension 4410 if lactate is above 4 mmol/L, systolic blood pressure stays below 90 mmHg after fluids, or the NEWS2 score rises to 7 or more. Between 20:00 and 08:00, outreach calls go to the on-call intensive care registrar through switchboard (extension 0).`,
  },
  {
    space: "maternity", section: "Protocols", title: "Postpartum haemorrhage (PPH) management", documentType: "protocol", reviewInDays: 20,
    body: `# Postpartum haemorrhage (PPH) management\n\n${DEMO_BANNER}\n\n## Definition\nPostpartum haemorrhage is blood loss of 500 ml or more within 24 hours of birth. Major PPH is blood loss of more than 1000 ml or any bleeding with signs of shock.\n\n## Call for help\nPull the emergency bell and call the obstetric registrar and the midwife in charge. For major PPH, also call the anaesthetist on extension 3120 and alert the blood bank on extension 3001.\n\n## First steps (the four Ts)\n1. Tone: rub up the uterus and give Uterotonin 10 units IM (fictional demo drug).\n2. Trauma: examine for tears and repair them.\n3. Tissue: check the placenta is complete.\n4. Thrombin: send blood for a clotting screen.\n\n## Ongoing care\nInsert two large-bore cannulas, take blood for full blood count and cross-match 4 units, and start warmed IV fluids. Weigh all swabs and pads to measure blood loss. Keep the woman warm and record observations every 15 minutes.`,
  },
  {
    space: "nursing", section: "SOPs", title: "Blood transfusion procedure", documentType: "sop", reviewInDays: -10,
    body: `# Blood transfusion procedure\n\n${DEMO_BANNER}\n\n## Before the transfusion\n1. Check the prescription is signed and states the component, volume and rate.\n2. Confirm the patient has given consent and it is recorded.\n3. Take baseline observations: temperature, pulse, blood pressure and respiratory rate.\n\n## Bedside check\nTwo registered staff must complete the bedside check together. Check the patient's identity verbally and against the wristband, and match it to the blood bag label and the compatibility form. Never complete the check away from the patient.\n\n## During the transfusion\nRepeat observations 15 minutes after starting each unit and at the end of each unit. Each unit must finish within 4 hours of leaving the blood bank fridge.\n\n## Suspected reaction\nStop the transfusion immediately, keep the line open with saline, call the doctor, and inform the blood bank on extension 3001. Return the bag and giving set to the blood bank.`,
  },
  {
    space: "biomedical", section: "Equipment manuals", title: "Aurelia VP-300 infusion pump: alarms and error codes", documentType: "equipment_manual", reviewInDays: 400,
    body: `# Aurelia VP-300 infusion pump: alarms and error codes\n\n${DEMO_BANNER} The Aurelia VP-300 is a fictional device.\n\n## Occlusion downstream\nThe pump has detected a blockage between the pump and the patient.\n1. Press STOP.\n2. Check all clamps on the line are open.\n3. Check the line for kinks.\n4. Press START. If the alarm repeats after these checks, do not keep restarting the pump. Remove it from use and report it.\n\n## Air in line\n1. Press STOP and close the roller clamp.\n2. Remove the set and clear the air following the priming instructions.\n3. Reload the set and press START.\nNever tape over, bypass or disable the air sensor.\n\n## Error codes\n| Code | Meaning | Action |\n|---|---|---|\n| E-12 | Door sensor fault | Close the door firmly. If the error remains, remove the pump from service. |\n| E-21 | Pressure sensor fault | Stop the infusion, remove the pump from service, label it faulty and call biomedical engineering on extension 2270. Do not restart the pump. |\n| E-30 | Battery fault | The pump can run on mains power only. Report it for battery replacement. |`,
  },
  {
    space: "pharmacy", section: "Formulary", title: "Antimicrobial formulary (demo)", documentType: "formulary", reviewInDays: 180,
    body: `# Antimicrobial formulary (demo)\n\n${DEMO_BANNER} All drug names below are fictional.\n\n## Restricted antimicrobials\nRestricted antimicrobials need approval from the on-call microbiologist before the second dose. Request approval through pharmacy on extension 2550.\n\n## First-line choices\n| Infection | First line | Alternative |\n|---|---|---|\n| Sepsis, source unknown | Demomycin 1 g IV 8-hourly | Placebocillin 2 g IV 6-hourly |\n| Community-acquired pneumonia | Testacillin 500 mg oral 8-hourly | Demomycin 1 g IV 8-hourly |\n| Lower urinary tract infection | Fictoxacin 200 mg oral 12-hourly for 3 days | Testacillin 500 mg oral 8-hourly |\n\n## Review\nReview every antimicrobial prescription at 48 hours: stop, switch to oral, or continue with a documented reason.`,
  },
  {
    space: "billing", section: "HMO rules", title: "CareShield HMO: pre-authorisation rules", documentType: "billing", reviewInDays: 90,
    body: `# CareShield HMO: pre-authorisation rules\n\n${DEMO_BANNER} CareShield is a fictional HMO.\n\n## Services that need pre-authorisation\nRequest pre-authorisation through the CareShield provider portal before providing:\n- MRI and CT scans.\n- Any admission expected to last more than 24 hours.\n- Elective surgery.\n- Physiotherapy beyond six sessions.\n\n## Emergencies\nEmergency treatment does not need pre-authorisation. Notify CareShield through the portal within 48 hours of an emergency admission, or the claim may be rejected.\n\n## Claims\nSubmit claims within 30 days of discharge, with the pre-authorisation code where one was required.`,
  },
  {
    space: "hospital-wide", section: "Policies", title: "Medical equipment fault reporting", documentType: "policy", reviewInDays: 365,
    body: `# Medical equipment fault reporting\n\n${DEMO_BANNER}\n\n## Removing equipment from use\nAny member of staff who believes a medical device is faulty must stop using it, attach a red DO NOT USE label, and move it out of the clinical area when it is safe to do so. Keep any disposable sets attached, because biomedical engineering may need them to investigate.\n\n## Reporting\nReport the fault to biomedical engineering on extension 2270 and complete an equipment incident form within 24 hours. If a patient was harmed or could have been harmed, also complete a clinical incident report and tell the nurse in charge immediately.\n\n## Returning equipment to use\nOnly biomedical engineering may remove a DO NOT USE label and return a device to service, after testing it.`,
  },
  {
    space: "hospital-wide", section: "Policies", title: "Hand hygiene policy", documentType: "policy", reviewInDays: 365, mustRead: true,
    body: `# Hand hygiene policy\n\n${DEMO_BANNER}\n\n## The five moments\nClean your hands before touching a patient, before a clean or aseptic procedure, after body fluid exposure risk, after touching a patient, and after touching patient surroundings.\n\n## How\nUse alcohol hand rub for at least 20 seconds when hands are not visibly dirty. Wash with soap and water for at least 40 seconds when hands are visibly dirty, after caring for a patient with diarrhoea, and when caring for patients with suspected spore-forming infections.\n\n## Audits\nInfection prevention and control audits hand hygiene in every ward each month. Results are shared with the ward manager within 5 working days.`,
  },
  {
    space: "emergency", section: "SOPs", title: "Guide rapide : pompe VP-300 en réanimation", documentType: "sop", reviewInDays: 200, language: "fr",
    body: `# Guide rapide : pompe VP-300 en réanimation\n\n> DOCUMENT DE DÉMONSTRATION pour tester DocInsight. Contenu fictif : pas d'usage clinique.\n\n## Programmation\nEn réanimation, programmer toujours la pompe à partir de la bibliothèque de médicaments du service. La saisie manuelle du débit n'est autorisée qu'après vérification par un second infirmier.\n\n## Pannes\nEn cas de code E-21, retirer immédiatement la pompe et la remplacer par une pompe de rechange. Les pompes de rechange se trouvent au magasin du 2e étage, armoire B. Appeler le service biomédical au poste 2270.`,
  },
];

/** Demo evaluation set (the real set is 100 questions written with each hospital's clinical champion). */
export const DEMO_EVAL: { question: string; expectTitle: string | null; expectPage?: number }[] = [
  { question: "When should I screen an adult for sepsis?", expectTitle: "Adult sepsis screening and escalation" },
  { question: "Who do I call if lactate is above 4?", expectTitle: "Adult sepsis screening and escalation" },
  { question: "What is the first antibiotic for sepsis?", expectTitle: "Adult sepsis screening and escalation" },
  { question: "bleeding after delivery what do I do", expectTitle: "Postpartum haemorrhage (PPH) management" },
  { question: "What counts as major PPH?", expectTitle: "Postpartum haemorrhage (PPH) management" },
  { question: "How often do I do observations during a blood transfusion?", expectTitle: "Blood transfusion procedure" },
  { question: "What do I do if a patient reacts to a transfusion?", expectTitle: "Blood transfusion procedure" },
  { question: "How long can a unit of blood run?", expectTitle: "Blood transfusion procedure" },
  { question: "The pump shows E-21. Can I restart it?", expectTitle: "Aurelia VP-300 infusion pump: alarms and error codes" },
  { question: "Occlusion alarm keeps going off", expectTitle: "Aurelia VP-300 infusion pump: alarms and error codes" },
  { question: "Can I tape over the air sensor?", expectTitle: "Aurelia VP-300 infusion pump: alarms and error codes" },
  { question: "First line for a UTI?", expectTitle: "Antimicrobial formulary (demo)" },
  { question: "Who approves restricted antibiotics?", expectTitle: "Antimicrobial formulary (demo)" },
  { question: "Does CareShield need pre-authorisation for a CT scan?", expectTitle: "CareShield HMO: pre-authorisation rules" },
  { question: "How long do we have to submit an HMO claim?", expectTitle: "CareShield HMO: pre-authorisation rules" },
  { question: "A machine is broken, what do I do?", expectTitle: "Medical equipment fault reporting" },
  { question: "How long should I use alcohol hand rub?", expectTitle: "Hand hygiene policy" },
  { question: "Où sont les pompes de rechange ?", expectTitle: "Guide rapide : pompe VP-300 en réanimation" },
  { question: "What is the dose of paracetamol for a child?", expectTitle: null },
  { question: "Write me a poem about nurses", expectTitle: null },
  { question: "What is the visiting time for the children's ward?", expectTitle: null },
  { question: "Who won the football last night?", expectTitle: null },
];

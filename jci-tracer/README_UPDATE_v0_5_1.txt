JCI Nursing Tracer — Workflow Pilot v0.5.1

Situation-Driven matching correction for Workflow Pilot DB v0.6.1.

What changed
- Interview situation choices are shown only when the current unit and role have at least one eligible question.
- The Hemodialysis choice matches the existing Dialysis question tag (11 SN, 14 HN questions in the RDU profile).
- Dialysis Vascular Access is available for the Hemodialysis/RDU Head Nurse role through the existing vascular-access protocol question. It is not offered to SN/CN without an eligible dedicated interview question.
- Options without interview questions, such as Phototherapy in NICU and Urinary Catheter/CAUTI in OPD, are absent from Interview. Their service/scope records and Observation data remain intact.
- Saved templates and past results remain in the same local database; no migration or reset is performed.

Update on GitHub Pages
1. Upload the contents of this ZIP to the existing /jci-tracer/ directory, replacing the app files. Keep the same URL and directory structure.
2. On the iPad, open Data > Export Backup before replacing the database.
3. Open Data > Replace Pilot Database and import JCI_Tracer_Workflow_Pilot_DB_v0_6_1.json.
4. Refresh the app and verify the heading says Workflow Pilot v0.5.1 and Data shows DB v0.6.1.

This is a workflow pilot. Full local policy verification and content review remain pending.

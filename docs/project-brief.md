# Food Tracker App — Project Brief

> The original brief, as written at the start of planning (2026-10-06). Later decisions on the [map](https://github.com/DF-AI-Lab/Food-Tracker/issues/1) override parts of it. In particular, V1 now uses manual + voice + photo inbox (no live camera or barcode), is phone-only, and pulls the meal planner and A4 sheet into V1.

## 1. What we're building

A **mobile-first household food management web app**.

The main purpose is to make it extremely easy to add food after shopping, record its use-by/best-before date, keep track of what's in the fridge, and use that food when planning meals for the week.

The core interaction should be:

> **📷 Point → 🎙️ Speak → ✅ Confirm → Done**

The app should remove as much typing and manual data entry as possible.

## 2. The main use case

After doing the weekly shop, the user gets home and wants to quickly add food to the fridge inventory.

The user points their phone at a packet of gammon. The camera is running **inside the web app**. The user says:

> "Add this to the fridge."

The app reads the packaging and identifies **Gammon**, **Use by: 08/10/2026**, then asks:

> **Gammon — Use by 8 October**
> Add to fridge?

User taps **YES**. Done. No typing required.

## 3. Camera requirements

- Use the phone's **live camera feed**.
- Do NOT require the user to take a normal photograph.
- Do NOT save the captured camera image to the phone's gallery.
- Camera images should only be used temporarily for processing.
- The user should see the live camera view inside the app.
- The user points the camera at the food packaging, and the app attempts to identify the food and relevant date information.

The camera is an input mechanism, not a photo-taking feature.

## 4. Voice requirements

Voice should feel similar to an Alexa-style interaction. Examples:

- "Add this to the fridge."
- "Add this as a main for Friday."
- "Add two packs of sausages."
- "Remove the gammon."
- "What's going out of date tomorrow?"

Voice provides **context/instructions**, while the camera provides visual information. For example, the camera detects *Gammon, Use by 08/10/2026*, and the user says "Add this as a main for Friday". Result: **Friday → Gammon → Main**.

## 5. Three input methods

- **📷 Camera:** product name, use-by date, best-before date, potentially quantity and other useful packaging information.
- **🎙️ Voice:** add this to the fridge, add this as a main, add this for Friday, remove this, what's going out of date?
- **✍️ Manual:** fallback when camera/voice cannot reliably determine something. It should be simple rather than a large form:

```text
Food: Gammon
Date: 08/10/2026
Type: Fridge
```

## 6. Identification strategy

Do not assume OCR will always work perfectly. Packaging is difficult: glossy plastic, curved and crinkled packaging, poor lighting, small printed dates, dates in unusual locations, different date formats.

Potential hierarchy: 1) Barcode 2) OCR 3) Voice 4) Manual entry. These methods can be combined. For example, the barcode gives *Tesco Gammon Joint 750g* and OCR gives *Use by 08 OCT*.

The app should never confidently invent information. If the date is detected but the product isn't, it should ask "What is the food?"

## 7. Date handling

Distinguish **Use by**, **Best before** and **Best before end**. Understand formats like `08/10`, `08/10/26`, `08 OCT`, `08 OCT 2026`, `081026`. If uncertain, ask the user to confirm rather than silently guessing. Store a proper date:

```text
date_type: use_by
date: 2026-10-08
```

## 8. Fridge inventory

A live list of food currently available, with easy-to-see dates. Items approaching their use-by date are highlighted.

| Food | Date | Status |
|---|---|---|
| Gammon | 08/10 | Soon |
| Chicken | 10/10 | OK |
| Sausages | 12/10 | OK |

Quick actions: mark as used, delete, edit, change date, use in meal planning.

## 9. Weekly meal planning

A simple weekly planner with separate **Mains** (Gammon, Chicken, Lasagne, Sausages) and **Sides** (Chips, Peas, Cauliflower, Rice). The user decides what to eat. The app should **not take control of meal choices**, only make available food easy to see and select. Selections can be changed or deleted.

## 10. Food connects to meal planning

Food in the fridge should be available when creating the weekly plan. Food going out of date soon should be easy to notice, to help reduce waste.

## 11. Used food

Marking food as used (or thrown away / removed) must be extremely quick. Once marked, it no longer appears as available stock.

## 12. Printable A4 weekly sheet

A simple printable A4 sheet: week header, Monday–Sunday with Main/Side lines, and the fridge list with ☐ tick boxes. It's kept in the kitchen, ticked by hand, and the app is updated later. The paper copy is deliberately part of the workflow.

## 13. Mobile vs PC

Mobile-first (camera and voice), but it also works on a PC. Phone: scanning, voice, quick updates, checking the fridge, marking used. PC: managing the list, building the plan, editing, printing. Both access the same data.

## 14. Data

Ultimately cloud-stored so the phone and PC stay in sync. Backend not fixed: establish the minimum useful data model first.

```text
Food: id, name, quantity, date, date_type, location, status, category, created_at
Meal: date, main, side
```

## 15. Important UX principle

The app should feel **fast**: Point → Speak → Confirm → Done. If it becomes another household chore, it has failed.

## 16. V1 (original suggestion)

V1 proof: live camera → read name + date → show result → confirm → add to the fridge list. Then V1.1 voice, V1.2 barcode, V2 meal planning, V2.x A4 sheet. Later: notifications, shopping lists, freezer/cupboard, quantities.

## 17. Don't overbuild initially

No complex AI agents, automatic meal decisions, huge database structures, shopping integrations, notifications, multiple household roles, nutrition tracking or full recipe management.

## 18. Success criteria

Someone comes home and adds several items quickly without typing. If that feels faster than manual entry, **the core idea works**.

## 19. Key principle

This is not primarily an OCR app. It is a **household food management app where camera and voice make data entry almost effortless.**

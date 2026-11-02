# VTOP Command

A browser extension that makes VIT's VTOP portal faster and easier to use. It adds a ⌘K / Ctrl+K command menu, a proper dark mode, and helpers built into the pages you already use: attendance, assignments, marks, CGPA and forms.

It works only on `https://vtop.vit.ac.in/vtop/*`. It reads VTOP the way you do, sends nothing anywhere else, and never submits anything for you.

---

## Contents

- [Install](#install)
- [Features](#features)
- [Safety: your account, requests and privacy](#safety-your-account-requests-and-privacy)
- [Development](#development)

---

## Install

The extension isn't on the Chrome Web Store yet, so you load it yourself. It works in Chrome, Brave, Edge and other Chromium browsers.

1. Build it from this folder:
   ```bash
   npm ci
   npm run build
   ```
   This creates `dist/vtop-command/` and `dist/vtop-command.zip`.
2. Open `chrome://extensions` (or `brave://extensions`) and turn on **Developer mode**.
3. Choose **Load unpacked** and select `dist/vtop-command`.
4. Open VTOP and sign in as usual.

After updating the code, run `npm run build` again, click the reload icon on the extension's card, and refresh VTOP.

---

## Features

### Command menu

Press **⌘K** on macOS or **Ctrl+K** on Windows/Linux on any VTOP page. You can also click the small launcher in the bottom-right corner, or the extension's toolbar icon.

- **Search every page:** type a page name, a category or a common alias, such as `DA`, `CGPA`, `timetable`, `attendance` or `marks`. Use ↑/↓ and Enter, or click a result.
- **Always current:** the menu reads VTOP's own menu each time it opens, including collapsed sections, so new pages show up on their own. Repeated names, such as regular and arrear exam schedules, are labelled by their section.
- **Opens pages VTOP's way:** choosing a page clicks VTOP's own menu link, exactly as if you had clicked it.
- **Commands:** **Home**, **Dark mode**, **Choose default semester** and **CGPA calculator** are all in the menu.
- **Launcher:** the small pill shows the logo, your shortcut and your default semester. Click the semester to change it.
- **Elsewhere:** the toolbar icon opens VTOP in a new tab when you're on another site.

### Dark mode

Turn it on from the menu's theme button or by searching `dark mode`. It's off by default and stays off until you choose it.

- Covers VTOP's cards, tables, menus, forms, accordions, tabs, date pickers and older page styles.
- **Readable text:** on dark backgrounds, low-contrast text is detected and lightened, keeping status colours such as green "Approved" and red "Absent" recognisable.
- **Time Table:** your registered slots are highlighted so classes stand out from free slots.
- **Untouched:** images, charts and PDF pages keep their original colours.
- **Live:** works on content VTOP loads later, and disappears completely when you switch back to light mode.

### Default semester

Pick your semester once and the extension selects it for you on every page that asks for one, such as Time Table, Attendance and Marks.

- The first page with a semester dropdown asks you to choose. You can also use **Choose default semester** in the menu, or click the semester in the launcher.
- It's applied once, when you open a page. If you then pick another semester, your choice stays, even when VTOP reloads that part of the page. Opening the page again from the menu starts with your default.
- If your saved semester isn't offered on a page, that dropdown is left alone.
- Registration, application, payment, feedback and similar pages are never changed automatically.

**Course Page:** the registered-course list shows only your default semester's courses. **All semesters** shows everything and stays selected until you open another page. If no default is set yet, **Default semester** opens the picker.

### Attendance calculator

On **Class Attendance**, each course shows how many classes you need to attend to reach 75%, or how many you can still miss while staying at or above it. It assumes every future class counts equally.

### Pending assignments

On **Digital Assignment Upload**, a **Pending** column (just before Dashboard) lists each course's unsubmitted assignments as date chips, earliest first.

- **Urgency colours:** overdue, due within two days, and later. Hover or focus a chip to see the assignment's name and time left.
- **Submitted work is hidden;** a course with nothing pending shows a dash.
- **Countdowns:** inside a course's dashboard, each pending due date shows how long is left.
- Deadlines use IST; a date with no time is treated as the end of that day.

How these are loaded, and why that's gentle on VTOP, is explained in [Safety](#safety-your-account-requests-and-privacy).

### Marks totals

On **Marks**, each course's table ends with a highlighted **Total** row adding up Max. Mark, Weightage %, Scored Mark and Weightage Mark. Its Remark cell shows how many marks you've already lost: Weightage % total − Weightage Mark total. Blank marks are skipped in the totals.

### CGPA calculator

Open the menu and choose **CGPA calculator**.

- **Loads your data:** it opens Grade History and Time Table through VTOP's own menu, the same way you would. It uses your default semester, and you can switch semesters inside the calculator.
- **Past results:** previous semesters' GPAs appear as tiles.
- **Expected grades:** every current course starts at S. Use **−** and **+** to set the grade you expect (S, A, B, C, D, E, F), and the projected semester GPA and CGPA update as you go. Your predictions are remembered on this device.
- **Grading rules:** S/A/B/C/D/E/F count as 10/9/8/7/6/5/0. F still counts its credits.
- **Excluded:** non-graded (NGCR) courses, zero-credit courses and unknown grades.
- **Cross-checked:** your previous CGPA is checked against the one VTOP shows. If they ever differ beyond rounding, VTOP's figure is used.
- **Not yet handled:** repeat-course and other special grading rules.

Nothing in the calculator changes your academic record.

### Form presets

Forms you fill in often, such as Late Hour Request and Leave Request, can remember your usual answers.

1. Click **Create preset** beside the form.
2. Fill in the copy of the form that opens, and leave **Automatically fill this form** on.
3. Choose **Save preset**.

Next time you open that form, your saved answers are filled in for you. **You still review it and press VTOP's submit button yourself.** Presets never submit anything.

- **Edit preset** reopens it, and its On/Off label shows whether auto-fill is active.
- **Reset** beside a field empties it and leaves it out of the preset. Resetting a School, Venue Type or Block also resets the fields that depend on it.
- **Dependent choices load as on VTOP:** on Late Hour Request, choosing a school loads its faculty, and choosing a venue type and block loads venues. These use VTOP's own lookups.
- **Excluded:** passwords, security codes, hidden fields and file uploads are never saved.
- **Cancel, Esc or a click outside** discards your edits. **Delete preset** removes it.

### Searchable dropdowns

Every dropdown in the extension's own windows (the semester picker, the CGPA calculator and the preset editor) has a search box. The long dropdowns on Late Hour Request and Leave Request are searchable too. Type to filter, use ↑/↓ and Enter to pick, and Esc to close.

### PDF viewer

VTOP's PDF downloads, such as course materials and the curriculum, open in a built-in viewer instead of downloading straight away.

- **Reading:** scroll through all pages, or type a page number to jump to it.
- **Zoom:** use ⌘/Ctrl + scroll, a trackpad pinch, ⌘/Ctrl + `+`/`−`, or the toolbar. ⌘/Ctrl + `0` or **Fit width** resets it.
- **Download** stays visible while loading and if previewing fails. It saves retained original bytes when available, or retries the original download natively when you click it.
- **Closing:** **Esc**, **Close** or a click outside closes the viewer.
- **Password-protected PDFs** ask for the password inside the viewer.
- **Bypass:** Shift-click a link to download it the normal way. Files that aren't PDFs download as usual.

The viewer is bundled with the extension (PDF.js), so documents are never sent to an outside service.

### Small fixes

- VTOP's top menus close when you press **Esc** or click outside them.
- Dialogs close when you click outside them.

---

## Safety: your account, requests and privacy

### Can this get my account flagged?

Only VIT decides how it treats browser extensions, so no one can honestly promise "zero risk". What we can do is show exactly what the extension sends. It was designed so that, to VTOP, it looks like a careful student clicking through the portal, and is often lighter than that:

- **It only uses VTOP's own requests.** Every request is one VTOP's own buttons and menus already send, to the same address, with the same fields and your existing sign-in. No hidden APIs, no guessed URLs, no scraping of other students' data.
- **It is read-only.** It never submits a form, uploads a file, registers, applies, pays or changes anything on your account. The only things it "clicks" are menu links, the Home link and dropdowns that load a view.
- **It never sends two of its own requests at once.** Automatic dropdown changes wait until VTOP has finished loading, then run one at a time. Opening another page cancels any that are still queued.
- **It caches aggressively.** Results are reused rather than asked for again (see the table below). Assignment results are kept for a random 1–5 hours per course, so refreshes never fall into a regular pattern.
- **It doesn't log in for you.** It never sees or stores your password, never fills in the CAPTCHA, and never keeps you signed in. Sign-in stays entirely between you and VTOP.
- **It never talks to any other server.** No analytics, no tracking, no remote code. The manifest only allows it to run on `vtop.vit.ac.in`.

### Every request the extension makes

| When | What is sent | How often |
| --- | --- | --- |
| You open a page from the command menu, or the CGPA calculator opens Grade History and Time Table | A click on VTOP's own menu link | Once per page you open; identical to clicking it yourself |
| A page asks for a semester and you've saved a default | VTOP's own dropdown change, which loads that semester's view | Once per page view; skipped on registration, payment and similar pages |
| The semester picker has no semester list yet | One Time Table request, as sent by VTOP's menu | At most once per page load, and the list is reused for a day |
| **Pending** column on Digital Assignment Upload | Each course's dashboard request, as sent by VTOP's Dashboard button | One course at a time, never in parallel. Each result is reused for a random 1–5 hours. It stops as soon as you open a dashboard yourself. |
| A preset is auto-filled, or you change a School, Venue Type, Block or Work field in the preset editor | VTOP's own lookup for that dropdown | Once per change, one at a time; never a submit |
| You open a PDF | The same download request your browser was about to send | Once automatically; an explicit Download click can retry it if loading failed |

**After you submit an assignment:** picking a file, submitting, or clicking Upload on a course dashboard clears that course's cached deadlines. If the course can't be identified, all of them are cleared. The Pending column then fetches fresh data next time, so it never shows work you've already handed in as pending.

### What it never does

- Submit, upload, register, apply, pay, or give feedback.
- Touch submit buttons, file inputs, password fields or CAPTCHAs.
- Change anything automatically on registration, application, payment, feedback or profile pages.
- Retry failed requests in a loop, or poll VTOP in the background.
- Send anything to any server other than VTOP.

### What's stored, and where

Everything stays in your browser on this device.

| Stored | Where | Kept until |
| --- | --- | --- |
| Theme, default semester, list of semester names (up to 30) | `chrome.storage.local` | You change them, or remove the extension |
| Form presets | `chrome.storage.local` | You delete the preset or remove the extension |
| CGPA grade predictions | `chrome.storage.local`, per student | You change them or remove the extension |
| Pending-assignment cache | `chrome.storage.session` (memory only) | 1–5 hours, an upload on that course, or closing the browser |
| Recent menu choices, attendance figures, PDFs being viewed | The open tab's memory | You close or leave the page |

Your password, marks history and attendance are never saved by the extension.

---

## Development

```bash
npm ci
npm test       # unit and DOM tests (Node's test runner + jsdom)
npm run check  # syntax check of every script
npm run build  # builds dist/vtop-command and the ZIP
```

Tests use made-up data shaped like VTOP's real markup. No account data is included. Features have been checked on a signed-in account by browsing only; not every VTOP page has been verified. See [the dark-mode audit](docs/dark-mode-audit.md) for what was checked and its limits.

### Files

| File | Purpose |
| --- | --- |
| `manifest.json` | Manifest V3: VTOP-only content scripts and storage permission |
| `brand.js` | Shared logo, colours and platform shortcut |
| `combobox.js` | Searchable dropdown used in the extension's own windows |
| `search-select.js` | Type-to-search for Late Hour and Leave Request dropdowns |
| `navigation.js` | Menu discovery, categories, aliases and search ranking |
| `semesters.js` | Semester dropdown discovery and matching; transactional-page guard |
| `content.js` | Command menu, launcher, preferences and default-semester selection |
| `dark.css`, `dark-readability.js` | Dark theme and contrast correction |
| `enhancements.js` | Attendance and deadline maths, and VTOP table readers |
| `page-enhancements.js` | Attendance rows, Pending column, marks totals, Course Page filter |
| `cgpa.js`, `cgpa-ui.js` | Grade History and Time Table readers, CGPA maths and calculator |
| `form-presets.js` | Form presets and their editor |
| `page-runtime.js`, `page-actions.js` | Waits for VTOP to be idle and runs automatic actions one at a time |
| `pdf-bridge.js`, `pdf-preview.js`, `pdf-viewer.*` | PDF download interception, preview window and PDF.js viewer |
| `extension-action.js` | Toolbar button and session-storage access |


### Image CAPTCHA prefill

Image CAPTCHA recognition runs locally using a small classifier trained for VTOP's six colored characters. It loads its bundled model only when a visible image CAPTCHA appears. Google reCAPTCHA remains manual. Prefilling preserves manual edits, discards stale results when images refresh, and never submits login or changes which challenge VTOP offers. Check the suggested answer before signing in. An unsupported image, ambiguous model result or loading error leaves the field manual.

This replaces the experimental Tesseract engine: no OCR WebAssembly, language pack, offscreen document, extra permission or model download is needed. The model is packaged with the extension, and images and results remain in memory. Only the prefill toggle is saved locally.

The model and fixed-position saturation preprocessing are adapted from [levyashvin/VTOP-Captcha-Solver](https://github.com/levyashvin/VTOP-Captcha-Solver/tree/b245a4b5d9ead1ffcc1fd6bafc98ef59815050bc), copyright © 2025 Yuva Yashvin, under the [MIT license](licenses/vtop-captcha-solver.txt). The upstream project credits ViBoot and VITrendz for the original logic/training data. Model provenance is included in `captcha-model.json`. Extension lifecycle, manual-edit protection and uncertainty checks are local adaptations; upstream code is never downloaded or executed at runtime.

The new classifier correctly recognized the previously failing VTOP image in a local test. One successful sample does not establish an overall accuracy rate. No CAPTCHA samples or answers are included in the repository. Login submission and server acceptance were not tested.

# Desktop application design

October 17, 2026 · BUILT_LOCAL / REVIEW_PENDING

The visual direction is shadcn-like: neutral surfaces, thin borders, quiet selection,
compact controls, semantic typography, and accessible native behavior in the existing
JavaScript application. This does not add React or claim to install shadcn components.

The desktop is a quiet workspace over one full-size globe canvas. Applications are
movable, overlapping windows. Desktop and Focus are the main presentation choices;
legacy Split desks open as Desktop. Small screens below 1200px display one focused
app while retaining its preferred floating geometry. Native OS wrappers and pop-outs
remain proposed.

## Product direction

Use the structure of a working desktop application: title bar, compact command bar,
selection or navigation, document/detail pane, and factual status. Keep actions where
their objects live. The Agent is an application and an optional planning action.
Avoid decorative emoji, neon panels, game HUD chrome, oversized hero copy, progress
steps that look like decoration, and repeated cards around every field. Preserve
necessary source, authority, uncertainty, budget, consent, and error information.

The Apple [window guidance](https://developer.apple.com/design/human-interface-guidelines/windows)
informs adaptable sizing and distinct active windows. W3C [toolbar guidance](https://www.w3.org/WAI/ARIA/apg/patterns/toolbar/)
informs the world controls' single tab stop and arrow/Home/End navigation. W3C
[dialog guidance](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/) informs native
modal containment, Escape, and launcher focus restoration. These are implementation
inputs, not an accessibility certification.

## Shared system

- Typography: system sans-serif; body 13px, labels 12px, section headings 12–16px,
  toolbar titles 14px, project document title 21px. Use tabular numerals for money.
- Surfaces: opaque charcoal `#181c1f`, sidebar `#1e2427`, restrained mint selection
  `#303b37`; light text `#e4e4e7`, muted text `#a1a1aa`. Translucency belongs
  to the desktop dock and world controls; forms and documents remain opaque.
- Spacing: 4/8/12/16/24px rhythm. Controls 30px on desktop, larger on mobile.
  Window corners 10px, controls 5px. Thin separators replace nested card outlines.
- State: every app has an active title bar; dock distinguishes running, minimized,
  and focused. Form fields have visible keyboard focus. Disabled actions stay visibly
  disabled. Empty states name the missing object and a real action.
- Navigation: labels accompany dock icons; Apps exposes all 11 apps. Search groups
  apps, actions, and currently authorized record metadata. Arrow keys navigate,
  Enter opens, Escape dismisses. Dialogs use the browser's native modal top layer.
- World: zoom, north, whole globe, Clean view, and Tools form a compact toolbar.
  Tools explicitly reveals the existing layer, camera, style, and tactical controls.
  Clean view turns off scope, HUD, detection, and bloom without changing the camera.
  Explicit shared camera and visual state still load on entry.

## Application anatomy and evidence

| App | Current local implementation | Remaining depth |
|---|---|---|
| Records | Compact record list, search, creation/import, selection and relationship inspector | Bulk editing and richer type-specific editors |
| Market | Quanta Universal Product Graph (`NBR-MARKET-001`), canonical products, legitimate variants, exact Landed Cost Engine, interactive 3D/CAD/blueprint projection viewer, multi-merchant offers comparison, Universal Cart with human authorization gate, cross-app handoffs (BOM, Messages, Agent, 3D Globe), proposal/commitment workflows | External federated adapters (Shopify MCP, UCP, eBay, SP-API) live-query qualification |
| Projects | Filterable master list, one selected project document, status control, place, milestones, materials, linked records/tasks/history | Dedicated milestone/material editors and large-list qualification |
| Messages | Channel selection, threads, replies, linked objects, private local compose | Real multi-user messaging and federation |
| Agent | Blank goal composer, explicit examples, plan review, two unchecked consent choices | External model/provider qualification; current domain planner is deterministic |
| Board | Native task/place/document columns and record inspection | Drag ordering and custom board columns |
| Documents | Native imported-document list, exact original access, inspector/history | Full document editing and non-text preview tooling |
| Evidence | Originals, review dimensions, claims, casebooks, text redaction and disclosure controls | Multimedia redaction and complete assistive-device qualification |
| Activity | Receipts, pending save reconciliation, recovery entry points | Rich audit filtering and retention policy |
| Desks | Save/update/restore named native arrangements, compatible v1/v2 reader | Multiple monitors, OS windows, multiple app instances |
| History | Revision history and existing world-time/source-policy tools | A dedicated history split-pane editor and physical valid-time reconstruction |

The shared design is applied across these apps; the table does not assert equal
feature depth or production readiness. Existing native command guards remain the
write authority. Adding evidence does not verify project completion.

## State and performance contract

App hosts remain stable across shell refreshes. Necessary data updates preserve
same-form text, focus, text selection and scroll. Context changes and handoffs may
change a selection while drafts remain in their own native form scope. Private
textual drafts save after 750ms and flush on blur/navigation; pairing precedes
recovery. Files and consent checkboxes require another deliberate choice.

Window movement changes DOM geometry only. ResizeObserver batches actual canvas
size changes into one viewer resize per animation frame. The same viewer/container
remain in place so Cesium picking and overlays keep their original coordinate space.
A partially visible canvas stays active. Focus pauses a hidden viewer after three
seconds; reveal resumes it without dropping animation holds. Provider credit and
its detail dialog sit above desktop windows with reserved dock clearance.

Verification and before/after captures: [desktop evidence](../../research/unified-world/desktop-foundation/REPORT.md).

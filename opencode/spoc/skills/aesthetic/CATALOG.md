# Aesthetic Playbook Catalog

> A designer's collection of patterns that make interfaces feel alive. Each pattern is a starting point — adapt, combine, and push further.

## How to Use This Catalog

Each entry follows this format:
- **When:** The moment to reach for this pattern
- **Feel:** How the result should feel to the user (not the developer)
- **How:** Lightweight implementation direction — CSS properties, animation concepts, not full code

---

## 1. Entrances

### Fade Up
**When:** Any new content appearing on screen — page loads, new sections, cards entering view
**Feel:** Like the content is gently rising into existence. Graceful, not sudden. The user's eye is drawn naturally.
**How:** Combine `opacity: 0→1` with `translateY(20px→0)` over 400-600ms. Use `ease-out` or a gentle spring. Start invisible and slightly below final position.

### Staggered Reveal
**When:** Groups of similar items appearing together — card grids, list items, navigation links
**Feel:** Like a wave washing across the screen. Each item acknowledges its neighbor's arrival before joining. Rhythmic, choreographed.
**How:** Same fade-up per item, but add 50-80ms delay between siblings. Keep total sequence under 500ms for groups of 5+. Use stagger utilities in animation libraries or `animation-delay` in CSS.

### Scale In
**When:** Modals, dialogs, tooltips, popups — things that demand attention
**Feel:** Like the element blooms from its trigger point. Organic, not mechanical. A flower opening.
**How:** `scale(0.95→1)` + `opacity(0→1)` over 200-300ms with `ease-out`. Transform origin should be the trigger point. Never scale from 0 — 0.95 is enough.

### Slide In
**When:** Panels, sidebars, drawers — content entering from an edge
**Feel:** Confident and purposeful. The panel knows where it belongs and moves there with conviction.
**How:** `translateX(-100%→0)` or `translateY(100%→0)` over 300-400ms with `ease-out` or `cubic-bezier(0.16, 1, 0.3, 1)`. Consider a subtle spring for overshoot that settles.

---

## 2. Exits

### Fade Out
**When:** Any content leaving the screen — dismissed items, navigating away, closing modals
**Feel:** A respectful departure. The content doesn't just vanish — it says goodbye. Quick but not instant.
**How:** `opacity: 1→0` over 150-200ms with `ease-in`. Exits should be faster than entrances — the user is moving forward.

### Collapse
**When:** Removing items from a list, accordion closing, dismissing notifications
**Feel:** The space the item occupied gracefully closes, like water filling a gap. Remaining items slide smoothly into new positions.
**How:** Animate `max-height` or `grid-template-rows: 1fr→0fr` alongside opacity. Layout animation on siblings. 200-300ms.

### Scale Out
**When:** Modals closing, popovers dismissing, tooltips vanishing
**Feel:** The element shrinks back into where it came from. Receding, not disappearing. Tucked away for later.
**How:** `scale(1→0.95)` + `opacity(1→0)` over 150-200ms with `ease-in`. Transform origin matches the trigger. Faster than entrance.

---

## 3. Hover & Focus

### Lift
**When:** Cards, buttons, clickable tiles — any element that invites interaction
**Feel:** The element rises slightly toward you, eager to be touched. Alive, responsive, aware of your cursor.
**How:** `translateY(-2px)` + `box-shadow` increase on hover. Transition 150-200ms. The shadow grows to sell the lifting illusion. Maximum 2-4px lift.

### Glow
**When:** Primary action buttons, important CTAs, focus states
**Feel:** A warm halo of energy. The element radiates importance. Magnetic.
**How:** `box-shadow: 0 0 0 4px rgba(accent, 0.15)` on hover/focus. Transition 200ms. Glow color should match the element's own color, not a generic blue.

### Scale Nudge
**When:** Icon buttons, avatar hovers, small interactive elements
**Feel:** A subtle breath — the element inhales slightly when you hover. Playful, alive.
**How:** `scale(1.05)` on hover. Transition 150ms with ease-out. Never above 1.1. Best on elements without text.

### Border Reveal
**When:** Input fields gaining focus, cards becoming active, tab selection
**Feel:** A line of energy tracing the element's shape. The UI highlights what matters right now.
**How:** `border-color` transition from transparent to accent, or `outline` with offset. 150ms. Can animate `outline-offset: 4px→0px` for a closing-in effect. Ring should be 2px.

### Color Shift
**When:** Navigation links, text buttons, secondary actions
**Feel:** A gentle temperature change. The text warms up or cools down to signal interactivity.
**How:** `color` transition over 150ms. Shift within the same color family but different lightness/saturation. Subtlety wins.

---

## 4. Transitions

### Cross-Fade
**When:** Page transitions, tab content switching, image carousels
**Feel:** One reality dissolves into another. Seamless, dreamlike. No harsh cut.
**How:** Outgoing `opacity: 1→0`, incoming `opacity: 0→1`, overlapping by 100-200ms. Total 300-400ms. Use shared layout animation if elements have common identifiers.

### Slide Replace
**When:** Step-by-step flows, wizard pages, horizontal navigation
**Feel:** Content physically moves to make room. Directional — you're going somewhere.
**How:** Outgoing slides left (`translateX(0→-30%)`), incoming from right (`translateX(30%→0)`). Both with opacity. 300ms. Direction matches navigation direction.

### Layout Morph
**When:** Grid to list view, expanding card detail, responsive layout changes
**Feel:** Elements smoothly rearrange themselves. Nothing teleports. The UI reshapes itself like a living organism.
**How:** Layout animation libraries or View Transitions API. Each element interpolates between old and new position. 300-500ms with ease-in-out.

### Expand/Collapse
**When:** Accordion content, detail panels, "show more" sections
**Feel:** The container breathes — expanding to reveal, contracting to hide. Organic.
**How:** Animate `grid-template-rows: 0fr→1fr` (CSS) or height with animation libraries. 200-300ms. Content fades in after container opens (50ms delay).

---

## 5. Loading & Empty

### Skeleton Screen
**When:** Initial page load, data fetching, content that takes >200ms to appear
**Feel:** The UI is already there — you can see its shape. Just waiting to be painted in. Confident, not anxious.
**How:** Gray placeholder shapes matching expected layout. Rounded rectangles for text, circles for avatars. Animate with shimmer gradient: `background-size: 200%`, sweeping left to right, 1.5s infinite.

### Progressive Reveal
**When:** Content loading in stages — hero first, then cards, then sidebar
**Feel:** The page builds itself in front of you. Layer by layer, like a painting. You start using it before it's all there.
**How:** Each section has its own loading state and entrance animation. As data arrives, sections transition from skeleton to real content with fade-up. Don't block the whole page for one slow API call.

### Empty State
**When:** No data, first use, search with no results
**Feel:** Friendly, not awkward. The empty space is an invitation. "Nothing here yet" should feel like "something great is about to happen."
**How:** Centered illustration or icon (soft, not harsh). Generous padding. Friendly copy. Clear CTA. The empty state should be designed, not an afterthought.

### Spinner (Last Resort)
**When:** Only when you can't show content structure — form submission, background process
**Feel:** Minimal, unobtrusive. An apology for making you wait.
**How:** Simple CSS animation. 24-32px. Match accent color. Prefer a subtle pulse or minimal line animation over a spinning circle. Place contextually near the trigger, not centered on screen.

---

## 6. Spacing & Rhythm

### The Breathing Room Rule
**When:** Always. Every layout decision. Every container.
**Feel:** The UI has space to exist. Content doesn't touch walls. Nothing feels cramped. Hierarchy is clear at a glance.
**How:** Minimum 24px padding in containers. 16px between related items, 32px+ between sections. Page top/bottom: 48-64px padding. Whitespace is structure, not waste.

### The 8px Grid
**When:** All spacing decisions — padding, margin, gap, sizing
**Feel:** Mathematical harmony. Everything aligns to an invisible grid. The spacing feels right even if you can't explain why.
**How:** All spacing as multiples of 8: 8, 16, 24, 32, 40, 48, 56, 64. Fine-tuning at 4px is acceptable. Never arbitrary values like 13px or 27px.

### Section Separation
**When:** Dividing major content areas — hero from content, content from footer
**Feel:** Clear chapters in a story. Each section is its own world, flowing into one narrative.
**How:** 64-96px vertical spacing between major sections. Whitespace alone creates separation. If you need a divider: `1px, opacity: 0.1`.

### Generous Padding
**When:** Cards, buttons, input fields, containers — anything with a border or background
**Feel:** Content inside has room to breathe. A button doesn't feel cramped. A card isn't suffocating its text.
**How:** Buttons: 12-16px vertical, 24-32px horizontal. Cards: 24-32px all sides. Inputs: 12-16px vertical, 16px horizontal. Modals: 32-48px. Always err toward more.

---

## 7. Typography

### Dramatic Scale
**When:** Page headings, hero text, section titles — moments where type commands attention
**Feel:** The heading is the first thing you see. It has gravity. It anchors the visual hierarchy.
**How:** Hero: 48-72px (mobile: 32-48px). Sections: 28-36px. Body: 16-18px. Heading-to-body ratio at least 2:1. Weight 600-700 for headings, 400 for body. Letter-spacing: -0.02em on large headings.

### Weight Contrast
**When:** Any text hierarchy — headings vs body, labels vs values
**Feel:** Important text is undeniably heavier. Your eye follows gravity — heavy pulls attention, light recedes.
**How:** Three weights maximum: bold (600-700) for headings, regular (400) for body, light (300) for secondary. Don't use medium (500) as body — it muddies contrast.

### Line Height & Measure
**When:** Any block of text — paragraphs, descriptions, long-form content
**Feel:** Text that invites reading. Eyes flow effortlessly from line to line.
**How:** Body line-height: 1.5-1.6. Headings: 1.1-1.2. Max line length: 65-75 characters (`max-width: 65ch`). Short lines beat long lines.

### Type as Art
**When:** Hero sections, landing pages, feature callouts — moments where typography IS the design
**Feel:** The letters themselves are beautiful. Type creates visual impact, not just information. Sculptural.
**How:** Oversized, tight-tracked headings. Mix display and body fonts. Negative letter-spacing (-0.03 to -0.05em) on large text. Color or opacity for depth. Sometimes a single large word beats a sentence.

---

## 8. Color & Depth

### Muted Palette Foundation
**When:** All base UI — backgrounds, cards, text, borders
**Feel:** Sophisticated restraint. The palette whispers. Colors work in harmony — nothing clashes.
**How:** Backgrounds: warm-tinted grays, not pure gray. Text: not pure black — `#1a1a1a` to `#2d2d2d`. Borders: `rgba(0,0,0,0.08-0.12)`. Cards: slightly lighter than page. Build on 2-3 neutral tones.

### Accent with Purpose
**When:** CTAs, active states, selected items — moments that need to pop
**Feel:** A single note of color singing against the muted background. Like a red umbrella in a gray cityscape. Intentional, not decorative.
**How:** One primary accent, used sparingly. Max 10-15% of visual area. Use opacity variants (`rgba(accent, 0.1)` for backgrounds, `0.2` for hover) rather than separate colors.

### Soft Gradient
**When:** Backgrounds, cards, hero sections, decorative elements
**Feel:** A gentle color journey. Not a rainbow — a whisper of change. Like the sky at dawn.
**How:** Two close-neighbor colors. Angle: 135deg or 180deg. Never more than 2-3 colors. Opacity 0.5-0.8 if overlaying content. Mesh gradients for extra richness.

### Shadow Layers
**When:** Cards, modals, dropdowns — anything elevated above the surface
**Feel:** Physical depth. The element floats naturally, casting a soft shadow like paper on a desk.
**How:** 2-3 layered shadows: `box-shadow: 0 1px 3px rgba(0,0,0,0.04), 0 4px 12px rgba(0,0,0,0.06), 0 12px 32px rgba(0,0,0,0.04)`. Very low opacity (0.04-0.08).

### Glassmorphism (Sparingly)
**When:** Overlays, navigation bars, floating toolbars
**Feel:** Frosted glass. Content behind is abstracted into color and blur. Elegant, layered, modern.
**How:** `backdrop-filter: blur(12-20px)` + semi-transparent background + `border: 1px solid rgba(255,255,255,0.2)`. Use only where it adds real value.

---

## 9. Cards & Containers

### The Floating Card
**When:** Content grouping — product tiles, features, dashboards
**Feel:** A physical object resting on the surface. Weight, dimension, presence.
**How:** `border-radius: 16-24px`. `padding: 24-32px`. White/surface background. Multi-layer shadow. Subtle border `rgba(0,0,0,0.04)`. Hover: shadow deepens + `translateY(-2px)`.

### The Flat Card
**When:** Dense layouts, data grids, settings — many cards competing
**Feel:** Quiet containers. They organize without demanding. Content inside is the star.
**How:** `border-radius: 12-16px`. `padding: 20-24px`. `background: rgba(0,0,0,0.02)`. `border: 1px solid rgba(0,0,0,0.06)`. No shadow. Hover: background darkens slightly.

### The Hero Card
**When:** Primary showcase, pricing highlight, main CTA area
**Feel:** This card matters most. It breaks sibling rules. Larger, more padded, different.
**How:** 1.5x sibling padding. Consider gradient border or accent background. Larger radius. Can break grid (span 2 cols). Most generous whitespace.

---

## 10. Micro-interactions

### Toggle Switch
**When:** Boolean settings, on/off states
**Feel:** Satisfying, physical. Like flipping a real switch. The knob travels with momentum and settles.
**How:** Knob `translateX` with spring easing. Background color cross-fade. 200ms. Slightly oversized knob. Color: desaturated gray → vibrant accent.

### Checkbox Check
**When:** Multi-select, task completion, form confirmations
**Feel:** A small celebration. The check draws itself. "Done" feels like achievement.
**How:** SVG path animation via `stroke-dasharray` + `stroke-dashoffset`. 200-300ms. Background fills simultaneously. Subtle scale bounce on container.

### Counter Change
**When:** Cart quantities, notification counts, score changes
**Feel:** Old number slides away, new slides in. Numbers are alive.
**How:** Outgoing `translateY(0→-100%)` + fade, incoming `translateY(100%→0)` + fade. 200ms. Clip overflow. Direction matches change (up for increase).

### Button Press
**When:** Any clickable button
**Feel:** Physical feedback. The button responds to your touch. It moves.
**How:** `scale(0.97)` on `:active`. Transition 100ms. Combined with color/shadow change. Return on release at 150ms.

### Progress Fill
**When:** Progress bars, loading indicators, completion meters
**Feel:** Energy flowing left to right. Fast at first, easing into position. Satisfying.
**How:** `width` or `scaleX` animation with `ease-out`. 400-600ms. Subtle gradient on fill (lighter at leading edge). Consider shimmer effect.

---

## 11. Scroll & Parallax

### Scroll-Triggered Reveal
**When:** Below-the-fold content — sections, cards, images not visible on load
**Feel:** The page rewards scrolling. Content materializes as you explore. Discovery.
**How:** Intersection Observer triggers entrance animation at threshold 0.1-0.2. Same fade-up as Entrances. Only animate once — don't re-trigger on scroll back.

### Subtle Parallax
**When:** Hero sections, background decorations, floating elements alongside content
**Feel:** Depth. Foreground moves faster than background. A gentle 3D effect without nausea.
**How:** `translateY` at 10-30% of scroll speed. `transform` only — never `top/left/margin`. Decorative elements only. Max offset: 50-100px.

### Sticky Reveal
**When:** Navigation headers, section titles, floating action buttons
**Feel:** The element becomes your companion. Always there when needed, arrived gracefully.
**How:** `position: sticky` + fade/slide entrance when stuck. Detect via Intersection Observer sentinel. When stuck: add subtle shadow + backdrop-blur. 200ms transition.

### Scroll Progress
**When:** Long-form content, multi-section pages
**Feel:** A quiet indicator of progress. There when you look, invisible when you don't.
**How:** Thin bar (2-3px) at viewport top. Width maps to scroll percentage. Accent color. `scaleX(0→1)` with `transform-origin: left`.

---

## 12. Responsive Beauty

### Fluid Typography
**When:** All type across breakpoints
**Feel:** Size adjusts like water — smoothly, without jumps.
**How:** `clamp(min, preferred, max)`. Example: `font-size: clamp(2rem, 5vw, 4.5rem)`. Preferred uses `vw` for smooth scaling.

### Responsive Spacing
**When:** All layout spacing across breakpoints
**Feel:** Proportional breathing room. Mobile has appropriately less space. Proportions still feel generous.
**How:** Fluid: `padding: clamp(16px, 4vw, 48px)`. Or define scale per breakpoint (mobile: 16/24/32, tablet: 24/32/48, desktop: 32/48/64). Ratios stay consistent.

### Layout Adaptation
**When:** Multi-column layouts hitting smaller screens
**Feel:** The layout reshapes elegantly. Cards reflow naturally. Nothing breaks.
**How:** CSS Grid with `auto-fit` + `minmax()`: `grid-template-columns: repeat(auto-fit, minmax(300px, 1fr))`. Let content determine breaks. When columns reduce, increase card padding.

### Touch Targets
**When:** Any interactive element on mobile
**Feel:** Easy to tap. Your thumb hits it every time.
**How:** Minimum 44x44px touch target (48px preferred). Padding counts. Space between tappable elements: minimum 8px. Full-width buttons on mobile stacked layouts.

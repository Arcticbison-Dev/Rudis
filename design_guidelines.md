# Altostratus Payments Design Guidelines

## Design Approach

**Reference-Based Approach**: Drawing inspiration from Linear (developer tool aesthetics) and Stripe (payment clarity and trust), with influences from modern fintech dashboards. This creates a privacy-focused, data-dense interface that emphasizes clarity, speed, and developer-friendly design.

**Core Principles**:
- Clarity over decoration: Information hierarchy drives every decision
- Privacy-first: Minimal, trustworthy, no unnecessary embellishments
- Speed perception: Fast-loading, responsive, instant feedback
- Developer-friendly: API-first mentality reflected in UI

---

## Typography System

**Font Families**:
- Primary: Inter (via Google Fonts) - all UI elements, body text, data
- Monospace: JetBrains Mono (via Google Fonts) - addresses, invoice IDs, API responses

**Hierarchy**:
- Page Titles: text-3xl md:text-4xl, font-semibold, tracking-tight
- Section Headers: text-xl md:text-2xl, font-semibold
- Card Titles: text-lg, font-medium
- Body Text: text-base, font-normal
- Labels: text-sm, font-medium, uppercase tracking-wide (for form labels)
- Data Values: text-lg md:text-xl, font-mono (for addresses, amounts)
- Metadata: text-xs md:text-sm, font-normal (timestamps, status text)
- API Endpoints: text-sm, font-mono

---

## Layout System

**Spacing Primitives**: Use Tailwind units of 2, 4, 6, 8, 12, 16, 20, 24
- Compact spacing: 2, 4 (within components, tight groups)
- Standard spacing: 6, 8 (between related elements)
- Section spacing: 12, 16, 20 (between major sections)
- Page margins: 24 (outer page padding on desktop)

**Grid Structure**:
- Dashboard: 12-column grid with gap-6
- Invoice cards: 3-column on xl, 2-column on md, 1-column on base
- Detail pages: max-w-4xl centered container
- Full-width tables: w-full with horizontal scroll on mobile

**Responsive Breakpoints**:
- Mobile-first approach
- Use md: for tablet (768px+)
- Use lg: for desktop (1024px+)
- Use xl: for wide screens (1280px+)

---

## Component Library

### Navigation
**Top Navigation Bar**:
- Fixed header: sticky top-0 with subtle border-b
- Left: Logo/app name (text-lg font-semibold)
- Center: Main nav links (Dashboard, Create Invoice, API Docs)
- Right: Status indicator (connection status), Settings icon
- Height: h-16
- Padding: px-6

### Dashboard Components

**Invoice Card**:
- Card container: rounded-lg border p-6
- Top row: Invoice ID (font-mono, text-sm) + Status badge
- Middle: Amount (text-3xl font-bold font-mono) + Currency
- Bottom: Description (text-sm), Creation timestamp
- Hover: Subtle border intensity change, cursor-pointer
- Grid layout: grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6

**Status Badges**:
- Pill shape: rounded-full px-3 py-1
- Sizes: text-xs font-medium uppercase tracking-wide
- States: Pending, Paid, Expired, Cancelled
- Icon prefix: Small dot indicator inline with text

**Data Table** (for invoice list view):
- Header: sticky top-16, font-medium text-sm uppercase tracking-wide
- Rows: hover state, border-b on each row
- Columns: Invoice ID (font-mono), Amount, Status, Created, Actions
- Mobile: Stack columns, show essential data only
- Padding: px-4 py-3 on cells

### Invoice Detail Page

**QR Code Section**:
- Centered QR code: w-64 h-64 on desktop, w-48 h-48 on mobile
- Container: border rounded-lg p-8 with subtle shadow
- Below QR: Payment address in font-mono, text-sm, with copy button
- Two-column layout on desktop: QR left, details right

**Payment Details Panel**:
- Clean info rows: label + value pairs
- Labels: text-sm font-medium, opacity-70
- Values: text-base or text-lg font-mono for addresses/amounts
- Spacing: space-y-4 between rows
- Copy buttons: Adjacent to copyable values (addresses, IDs)

**Real-Time Status Indicator**:
- Live update dot: Pulsing animation for pending
- Last updated timestamp: text-xs, auto-refreshing
- Confirmation count: Progress bar for blockchain confirmations

### Forms

**Create Invoice Form**:
- Single column: max-w-2xl mx-auto
- Field groups: space-y-6
- Input styling: 
  - Text inputs: border rounded-md px-4 py-3 text-base
  - Focus: ring-2 ring-offset-2
  - Font-mono for amount inputs
- Labels: text-sm font-medium mb-2 block
- Helper text: text-xs mt-1
- Currency selector: Segmented control (BTC / Lightning / XMR)
- Amount input: Large, prominent (text-2xl font-mono)
- Submit button: Full-width, py-3, font-medium

### Buttons

**Primary Actions**:
- Size: px-6 py-3 for standard, px-8 py-4 for hero CTAs
- Typography: text-sm md:text-base font-medium
- Border radius: rounded-md
- States: Implement hover/active transformations

**Secondary/Ghost Buttons**:
- Border variant: border-2 with transparent fill
- Icon-only: Square aspect ratio (w-10 h-10)
- Minimal: No border, subtle hover background

**Copy Buttons**:
- Icon + text or icon-only
- Size: px-3 py-1.5, text-xs
- Success feedback: Brief checkmark animation after copy

### Modals & Overlays

**Webhook Configuration Modal**:
- Centered: max-w-2xl
- Header: text-xl font-semibold, close button
- Form layout: space-y-4
- URL input: Full-width, font-mono for URLs
- Test webhook button: Secondary style

**Confirmation Dialogs**:
- Compact: max-w-md
- Icon at top (warning/success)
- Title + description: Center-aligned
- Button row: Flex justify-end, gap-3

### API Documentation Section

**Endpoint Cards**:
- Method badge: GET/POST in small pill (font-mono, text-xs)
- Endpoint path: text-lg font-mono
- Description: text-sm
- Code examples: Syntax-highlighted blocks with copy button
- Container: border-l-4 pl-6

**Code Blocks**:
- Background: Subtle contrast
- Font: JetBrains Mono, text-sm
- Padding: p-4
- Border radius: rounded-md
- Copy button: Absolute top-right

---

## Data Visualization

**Invoice Statistics** (Dashboard overview):
- Stat cards: Grid layout, 4 columns on xl, 2 on md, 1 on mobile
- Large number: text-4xl font-bold
- Label: text-sm uppercase tracking-wide
- Trend indicator: Small arrow icon with percentage

**Payment Timeline**:
- Vertical timeline for invoice events
- Dot indicators at each event
- Event title: font-medium
- Timestamp: text-xs font-mono
- Description: text-sm

---

## Animations & Interactions

**Minimal Animation Strategy**:
- QR code: Subtle fade-in on load (duration-300)
- Status updates: Smooth transition between states (transition-all)
- Copy feedback: Brief scale animation (scale-95 to scale-100)
- Loading states: Skeleton screens, subtle pulse
- Avoid: Excessive scroll effects, decorative animations

**Real-Time Updates**:
- WebSocket status: Pulsing dot when connected
- Invoice status change: Smooth color/text transition
- New invoice: Slide-in from top of list

---

## Accessibility & Interactions

**Focus States**:
- All interactive elements: ring-2 ring-offset-2 on focus
- Keyboard navigation: Visible focus indicators
- Tab order: Logical flow through forms and actions

**Touch Targets**:
- Minimum 44x44px for mobile tap targets
- Adequate spacing between adjacent buttons (gap-4 minimum)

**Copy Actions**:
- Click to copy: Instant visual feedback
- Tooltip: "Copied!" message, auto-dismiss after 2s

---

## Page-Specific Layouts

**Dashboard Page**:
- Top: Stats overview (4-column grid)
- Filter bar: Inline filters (Status, Date range) with subtle border-b
- Main content: Invoice cards or table view toggle
- Empty state: Centered, icon + message + CTA

**Create Invoice Page**:
- Centered form: max-w-2xl
- Sticky preview: On desktop, show live invoice preview in right column
- Validation: Inline error messages below fields
- Success: Redirect to invoice detail with success toast

**Invoice Detail Page**:
- Hero section: QR code + primary payment info
- Secondary info: Collapsible advanced details
- Activity log: Timeline of events (created, viewed, paid)
- Action buttons: Copy address, Send reminder, Mark as paid (admin)

**API Documentation Page**:
- Sidebar navigation: Sticky, sections for endpoints
- Main content: Single column, max-w-4xl
- Interactive API tester: Test endpoints directly in UI
- Response examples: Expandable/collapsible sections

---

## Images

**No Hero Images**: This is a utility application focused on functionality, not marketing. All visual emphasis comes from:
- Clean typography and data presentation
- QR codes (dynamically generated)
- Status indicators and icons
- Minimal decorative elements

**Icon Usage**:
- Use Heroicons (via CDN) for all interface icons
- Icon sizes: w-4 h-4 for inline, w-5 h-5 for buttons, w-6 h-6 for standalone
- Icon placement: Left of text in buttons, prefix for input fields
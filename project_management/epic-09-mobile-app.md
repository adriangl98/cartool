# E09 — Mobile App (React Native / Expo)

**Phase:** Phase 4 (Weeks 14–16, after E08 components are stable)  
**Goal:** A React Native (Expo) mobile app that shares logic and UI components with the web app, targeting iOS 16+ and Android 12+.  
**Spec Reference:** §3 (Tech Stack — React Native Expo managed workflow), §8 (UX/UI Spec), §12 (iOS 16+, Android 12+)  
**Depends On:** E08 (shared API client, i18n strings, component patterns), E07 (push token endpoint)

---

## Approach

The mobile app is **not a port** — it shares business logic and API client from `apps/web/` but uses React Native primitives for layout. Extract any shared pure logic (formatters, validators, API client) into a `packages/shared/` workspace package before beginning this epic.

---

## Features

### F09.1 — Expo Project Bootstrap

**Description:** Initialize the React Native project and configure shared packages.

**Tasks:**
- [ ] Initialize Expo managed workflow project in `apps/mobile/` using `npx create-expo-app`
- [ ] Configure a monorepo workspace (`pnpm workspaces` or Yarn workspaces) so `apps/mobile/` and `apps/web/` can import from `packages/shared/`
- [ ] Move the following from `apps/web/` to `packages/shared/`:
  - API client module (`api/`)
  - i18n locale files (`i18n/en.json`, `i18n/es.json`)
  - Zod validation schemas for budget inputs
  - Currency formatting utilities
- [ ] Install: `expo-router` (file-based routing), `react-i18next`, `expo-notifications` (for push), `@react-native-async-storage/async-storage`
- [ ] Configure EAS Build for iOS and Android

**Acceptance Criteria:**
- `npx expo start` launches the app in the Expo Go client without errors.
- Changing a string in `packages/shared/i18n/en.json` is reflected in both web and mobile apps.
- API client in `packages/shared/` makes requests to `EXPO_PUBLIC_API_BASE_URL` configured in `.env`.

---

### F09.2 — React Native Component Adaptations

**Description:** Adapt the key web components to use React Native primitives while preserving the same logic.

**Tasks:**
- [ ] Adapt `DealScoreGauge` using React Native's `react-native-svg` library (same SVG arc logic, different imports)
- [ ] Adapt `ListingCard` using `View`, `Text`, `TouchableOpacity` instead of `div` / `button`
- [ ] Adapt `ReverseSearchScreen` input form using `TextInput`, native pickers for term and deal type
- [ ] Build the Disclosure Panel as a React Native `BottomSheet` (use `@gorhom/bottom-sheet`)
- [ ] Ensure all touch targets are at minimum **44×44pt** (iOS HIG / Android Material guidelines)

**Acceptance Criteria:**
- `DealScoreGauge` renders correctly at all score values on both iOS and Android simulators.
- `ListingCard` renders without layout overflow on a 390px-wide screen (iPhone 14 form factor).
- All interactive elements have a minimum 44×44pt touch target.

---

### F09.3 — Push Notification Registration

**Description:** Request push notification permission from the user and register the device token with the backend.

**Tasks:**
- [ ] On first app launch (after login): request push notification permission using `expo-notifications`
- [ ] On permission granted: retrieve the Expo Push Token (or native APNs/FCM token for production build)
- [ ] Call `POST /users/push-token` with the token (authenticated request)
- [ ] On permission denied: silently skip; do not re-prompt on every launch (store permission decision in `AsyncStorage`)
- [ ] Handle token refresh: `expo-notifications` provides a listener for token changes; re-register on change

**Acceptance Criteria:**
- The permission prompt only appears once; subsequent launches silently skip if already responded.
- A granted permission results in the token being stored on the backend (`users.push_token` updated).
- Token refresh listener is registered and calls the backend on token rotation.

---

### F09.4 — Deep Link Handling

**Description:** Support deep links so push notifications can open directly to a listing detail screen.

**Tasks:**
- [ ] Configure `expo-router` deep link scheme: `laredoauto://listing/:id`
- [ ] Configure Universal Links (iOS) and App Links (Android) for `https://laredoautointel.com/listing/:id`
- [ ] Implement notification tap handler: when a deal alert push notification is tapped, navigate to `/listing/:id` using the `listingId` from the notification payload
- [ ] Test deep link from cold start (app not running) and from background state

**Acceptance Criteria:**
- Tapping a push notification from a cold start opens the app directly to the correct listing detail screen.
- Tapping from the background navigates without restarting the app.
- Universal Link `https://laredoautointel.com/listing/UUID` opens the mobile app (not the browser) when the app is installed.

---

### F09.5 — iOS & Android QA Pass

**Description:** Structured testing pass to verify the app meets all platform-specific requirements before beta.

**Tasks:**
- [ ] Test on physical device: iPhone (iOS 16 minimum) and Android 12 device
- [ ] Verify all screens in both English and Spanish
- [ ] Verify `DealScoreGauge` renders without clipping on smaller screen sizes (iPhone SE 2nd gen, 375px)
- [ ] Verify `DisclosurePanel` (bottom sheet) dismisses on swipe-down gesture on both platforms
- [ ] Verify push notification appears in notification tray in both foreground and background states
- [ ] Submit to TestFlight (iOS) and Google Play Internal Testing (Android) for beta distribution

**Acceptance Criteria:**
- Zero crashes on the three core flows (Reverse Search → Results → Disclosure) on iOS 16 and Android 12 devices.
- App Store Connect and Google Play Console show a successful build upload.
- Beta testers can complete the full Reverse Search flow from budget input to disclosure panel in under 60 seconds (matches web Phase 4 DoD).

---

## Dependencies

This epic has no downstream epics. It is the final deliverable of Phase 4.

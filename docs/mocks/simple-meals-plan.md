# Simple Meals page (next chat)

Darren, 2026-10-25. The Meals page feels like a mess, with too many ways to answer "what's for dinner?". The goal is to **limit waste**, so the page should plan ahead before food goes off.

Mock: `docs/mocks/simple-meals-mock.html` (artifact https://claude.ai/artifact/1CUwwP2kvvxMzShaNwoDFC). Darren likes how simple it is, but **it still needs changes**, so ask him what before building.

## The idea in the mock

1. **Use soon** strip at the top
   - Foods going off in the next 3 days
   - Orange means no dinner is planned for it yet
2. **This week**
   - Each empty day shows one suggestion: **✓ Plan** or **↻ Another**
   - ↻ goes through the app's ideas (My meals first, then plates), then asks the AI
   - **✨ Fill my week** fills every empty day
   - ✓ also saves the plate as combos, so the app learns
3. **Tucked away**: My meals and Combos, as folds at the bottom

Keep every feature, just in a simpler flow. These fold into the days:

- the Plan my week panel
- the Ideas for the week list
- Ask AI for dinner
- Ask AI for combos

## Where things stand

- Demo d.v4.48 has plates (1 main + 1 base + up to 2 goes-with) and ✨ Ask AI for dinner
  - Logic: `foodRole`, `pairRole`, `aiDinnerRequest`, `parseAiDinner` and `newComboRows` in `demo/js/logic.js`
  - Tests: `tests/v4-plates.test.js` and `tests/v4-ai-dinner.check.js`
- **Live is still v4.14 and doesn't have plates or AI dinner.** Copy to live only once the simple page is done and Darren says so.
- The AI dinner call has only been tested with a fake AI. No real request has been made yet.

## Darren's review, 2026-10-25 (chat 2)

Liked: the week list, the Plan my week panel (Swap / ✓ / Plan these), My meals, All combos + Ask AI for combos.
Didn't like: the open day card ("a mess"), Ideas for the week (same as Plan my week), two AI buttons.

### ✅ Built in demo d.v4.49
1. **Use soon** strip at the top of Meals (3 days, orange = not planned)
2. **One ✨ Plan my week** button. Ask AI for dinner removed from the page (logic kept in `logic.js` for later)
3. Plan my week panel kept as it was
9. Ideas for the week removed
10. All combos + Ask AI for combos kept

### 🎨 Mock next, then build
- 4. **Open day card**: revamp. One list of ideas + Plan, "Build my own" tucked away, no tabs, no Next buttons
- 5. Fri / Sat "Nothing left" → offer a My meal
- 6. My meals: tap a card to edit it in place, remove "✎ Edit meals"
- 7. **Musts vs extras** in each meal (less strict: musts in fridge = can plan, extras go on shopping)
- 8. **"+ Peas?" add-on**: suggest a going-off food that goes with a planned meal
- 3b. "🍽 Make a meal" link on Plan my week ideas
- ❓ Dinner / Tea toggle: keep or remove? (ask Darren)

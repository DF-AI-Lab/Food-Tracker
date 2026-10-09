# Food Tracker on your PC — setup

## Once only

1. **Install Node.js:** go to <https://nodejs.org>, download the **LTS** version, and install it with the default options.
2. Open this `windows` folder and **double-click `install.vbs`**.
3. You'll see "All set!"
4. **Make the icon:** in Chrome go to `127.0.0.1:5178`, then open **⋮ → Cast, save and share → Create shortcut…**, tick **Open as window**, and click **Create**.

## Auto-updates (once only)

1. Install **Git for Windows:** go to <https://git-scm.com/download/win> and install it with the default options.
2. Double-click **`windows/setup-updates.vbs`**.
3. If GitHub asks you to sign in, sign in.

After that, new changes arrive within about 5 minutes. **Just refresh the app.**

## Every day

- Click the **Food Tracker** icon. The app opens in its own window.
- The server starts silently with Windows. You won't see a black window.

## Where your food list is saved

`FoodTrackerData\food.db`, the folder **next to** the app folder.

- A backup copy is made each day in `FoodTrackerData\backups\` (the last 14 are kept).
- Rebuilding or replacing the app folder doesn't touch your data.
- If you move or rebuild the app folder, double-click `install.vbs` again.

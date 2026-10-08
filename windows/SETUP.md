# Food Tracker on your PC — setup

## Once only

1. **Install Node.js:** go to <https://nodejs.org>, download the **LTS** version, and install it with the default options.
2. Open this `windows` folder and **double-click `install.vbs`**.
3. You'll see "All set!" and a **Food Tracker** icon on your desktop.

## Every day

- Click the **Food Tracker** icon. The app opens in its own window.
- The server starts silently with Windows. You won't see a black window.

## Where your food list is saved

`FoodTrackerData\food.db`, the folder **next to** the app folder.

- A backup copy is made each day in `FoodTrackerData\backups\` (the last 14 are kept).
- Rebuilding or replacing the app folder doesn't touch your data.
- If you move or rebuild the app folder, double-click `install.vbs` again.

# Personal settings

Everything a person sets for themselves is in the **account menu**: select your name at the bottom of the sidebar.

| Setting | What it does | Where it's kept |
|---|---|---|
| **Notification settings** | Which events reach you in the app and by email. Some are required. | Your account (`/settings/notifications`) |
| **Connected apps** | AI tools you connected with OAuth sign-in; disconnect one to stop it ([`mcp.md`](mcp.md)). | Your account (`/settings/connected-apps`) |
| **Theme** | **System** (the default), **Light** or **Dark**. | This browser |

## Theme: light and dark

With **System**, Grounded follows your device's light or dark setting and changes with it while the page is open (a device that switches to dark at sunset takes Grounded with it). **Light** and **Dark** keep that look whatever the device says.

The choice is kept in this browser (local storage), not in your account: another browser or device starts on System, and signing out keeps it. Other tabs of the same browser change at once.

The page is drawn in the right theme from the start, with no flash of the other one: a small script, `/color-mode.js`, sets `<html data-theme>` before the page is drawn. It's a file rather than inline code because the app's Content Security Policy allows same-origin scripts only.

**Visitors** of a public agent page and of the widget have no account menu: both follow the visitor's device setting. A choice made in the same browser on the same Grounded site applies to the public page too. On another site, the widget's launcher and frame follow the visitor's setting; in dark the launcher has a light ring so a dark accent colour still stands out, and its focus ring is white.

Agent accent colours always carry white text (at least 4.5:1, checked when the accent is saved), so they read the same in both themes. Every page passes WCAG 2.1 AA in both (axe in the browser tests).

For operators: every bitop-ui theme defines both light and dark values (`UI_THEME` picks the theme, the person picks light or dark). See [`web/README.md`](../web/README.md).

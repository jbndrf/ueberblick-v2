# Sign in and out as an admin

Admins work in the admin area (`/admin`), field workers in the app (they sign in with their QR code, see *Issue and revoke QR logins*).

## Sign in
1. Open `/admin/login`. If you open an admin page directly and are not signed in, you land here and return to that page after signing in. Addresses outside this installation are ignored; you then land on "Projects".
2. Enter your e-mail and password, then choose "Sign in". The eye in the password field shows what you typed. With `ADMIN_TOTP=on`, also enter the 6-digit one-time code from your authenticator app.
3. You land in the admin area (see *The admin area*). The sidebar lists, under "Your projects", the projects in which your account has a role.

At the top right of the sign-in page you switch language and theme (light or dark).

A one-time code works once. If sign-in fails, one message appears that does not say whether the password or the code was wrong. After several failed attempts you have to wait a moment.

## First sign-in
Without the one-time code (`ADMIN_TOTP=off`, the default) you sign in directly. With `ADMIN_TOTP=on` you enrol the code at sign-in yourself: leave the field empty and sign in; after the right password the sign-in screen shows a QR code (and the key to type by hand) for your authenticator app once. Sign in with the first code from the app; that confirms the code. The operator can instead confirm the code when creating the account (`npm run admin -- confirm-totp <e-mail> <code>`).

## Sign out
Open the account menu at the top right and choose "Sign out". The session ends and you see the sign-in page again.

If you have an account but no role in any project, the sidebar shows "No projects yet"; the operator adds you to a project (`add-membership`).

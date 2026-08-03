# Security notes

- Do not commit the shared password anywhere in this repository.
- Do not commit the source `.xlsx` file.
- Publish only the encrypted `data.enc` file.
- If the password is exposed, regenerate `data.enc` with a new password.
- Anyone who knows the shared password can decrypt and inspect the data in their browser.

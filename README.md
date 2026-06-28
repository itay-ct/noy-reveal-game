# Noy Bat Mitzvah Reveal Game

Static Hebrew reveal game for GitHub Pages.

## Publish On GitHub Pages

1. Create a new GitHub repository.
2. Upload all files from this `game` folder to the repository root.
3. In GitHub, open `Settings` -> `Pages`.
4. Choose `Deploy from a branch`.
5. Select `main` and `/root`, then save.

The site URL will usually be:

`https://YOUR-GITHUB-USER.github.io/REPOSITORY-NAME/`

## Edit Questions

Edit `questions.csv` in GitHub and commit the change.

Columns:

```csv
guest,question,answer a,answer b,answer c,right answer
```

Rules:

- `guest` must exactly match the guest name in `data.js`.
- `right answer` must be one of: `answer a`, `answer b`, `answer c`.
- If an answer contains a comma, wrap it in quotes.

Example:

```csv
איתי,מה איתי הכי אוהב?,תשובה א,תשובה ב,תשובה ג,answer b
```

The game fetches `questions.csv` when hosted online, so question edits do not require rebuilding `data.js`.

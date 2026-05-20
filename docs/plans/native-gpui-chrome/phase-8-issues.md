# User reported issues from Phase 8 implmentaion

## Blockers

1. Clicking on the notes search crashes with paniic
2. Note web view renders and goes blank once the mouse moved over it

## High Priority

1. Note list top bar title need to reflect the title of the iems selected in the side bar
2. Active Projects view filer does not work
3. All clikable buttons lack the hints
4. Vault picker popup does not close on focs loss
5. Side bar Types, Views, Folder are not collpsable
6. System menu is missing items for File, View, Help

## Low Priority

1. Inspector view should be opened in a separate windows, not a pannel
2. System window menu shoud display Show Sidebar|Hide Sidebar, Show Inspector|Hide Inspector depending on the current state

### Periscope Phase 8 smoke sweep

**Status:** ⏳ pending — run on host before Phase 8 close-out.

**Recipe:** see `periscope-phase-8-sweep.md`.

**Why it's not automated yet:** periscope requires Screen Recording + Accessibility permissions on the parent terminal, plus a windowed Tolaria binary; the Anthropic agent sandbox can't satisfy either.

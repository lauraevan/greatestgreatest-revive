# Real logo overrides

Drop a real vendor logo in here as `<app-id>.svg` or `<app-id>.png` and
`npm run generate:app-icons` will copy it over the generated artwork for that
app, leaving everything else untouched.

The app id is the file name the portal already asks for. To find it, look at the
tile's `icon` path in `src/data/apps.ts` — `/app-icons/ixl.svg` means the id is
`ixl`, so `assets/app-icons/ixl.svg` replaces it.

Square artwork works best. Clever rounds icons in CSS at `border-radius: 10%`,
so supply full-bleed square files with no rounding of their own.

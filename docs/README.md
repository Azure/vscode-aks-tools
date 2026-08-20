# Visual Studio Code AKS Tools — Documentation

The docs are an [mdBook](https://rust-lang.github.io/mdBook/) under [`book/`](./book/),
published to GitHub Pages by [`website.yaml`](../.github/workflows/website.yaml).

`book/src/` is the single source of truth. Do not copy pages elsewhere.
Navigation is [`book/src/SUMMARY.md`](./book/src/SUMMARY.md); a page not listed there is not published.

```sh
make -C docs/book build    # build into docs/book/book/
make -C docs/book serve    # live preview
```

Do not bump `MDBOOK_VERSION` in [`book/Makefile`](./book/Makefile) without updating
[`book/book.toml`](./book/book.toml) — later mdBook releases dropped `multilingual` and
renamed `curly-quotes`.

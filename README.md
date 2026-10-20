# Dotfiles

OS X configuration files. There's no place like ~/.

## Installation

```shell
$ /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
$ curl -fsSL https://raw.githubusercontent.com/BarryThePenguin/dotfiles/main/bin/bootstrap | bash
```

`bin/bootstrap` installs mise, clones this repo to `~/src/btp/dotfiles`, then runs `mise bootstrap --yes`. Pass a profile (`home`, `work` or `devcontainer`) with `bash -s work`; it is saved to `~/.config/mise/miserc.local.toml`, and the default is `home`. To preview, run `mise bootstrap --dry-run` from the clone.

[AGENTS.md](AGENTS.md) describes the repo layout.

## Includes

- https://github.com/dracula/ghostty.git
- https://github.com/marzocchi/zsh-notify.git
- https://github.com/sorin-ionescu/prezto.git

## See also

- [yoshuawuyts/dotfiles](https://github.com/yoshuawuyts/dotfiles)
- [pengwynn/dotfiles](https://github.com/pengwynn/dotfiles)
- [kevensuttle/osxdefaults](https://github.com/kevinSuttle/macOS-Defaults/blob/master/.macos)
- [marcusandre/dotfiles](https://github.com/marcusandre/dotfiles)
- [nicknikolov/dotfiles](https://github.com/nicknikolov/dotfiles)

## License

[MIT][license] © [Jonathan Haines][author]

<!-- Definitions -->

[license]: LICENSE
[author]: http://jonno.dev

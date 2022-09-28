username="btp"

# utf-8 & screen
export LC_ALL="en_US.UTF-8"
export TERM="screen-256color"

export XDG_CONFIG_HOME="$HOME/.config"
export ZDOTDIR="$XDG_CONFIG_HOME/zsh"
export GNUPGHOME="$XDG_CONFIG_HOME/gpg"

# Ensure that a non-login, non-interactive shell has a defined environment.
if [[ ( "$SHLVL" -eq 1 && ! -o LOGIN ) && -s "$ZDOTDIR/.zprofile" ]]; then
  source "$ZDOTDIR/.zprofile"
fi

# shortcut to this dotfiles path is $ZSH
export ZSH="$HOME/src/$username/dotfiles"
export DOTFILES="$HOME/src/$username/dotfiles"

# your project folder that we can `c [tab]` to
export PROJECTS="$HOME/Blake"

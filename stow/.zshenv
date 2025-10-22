username="btp"

# utf-8 & screen
export LC_ALL="en_US.UTF-8"
export TERM="screen-256color"
export EDITOR="code --wait --new-window"

export XDG_CONFIG_HOME="$HOME/.config"
export XDG_CACHE_HOME="$HOME/.cache"
export MISE_SOPS_AGE_KEY_FILE="$XDG_CONFIG_HOME/mise/age.txt"
export ZDOTDIR="$XDG_CONFIG_HOME/zsh"
export GNUPGHOME="$XDG_CONFIG_HOME/gpg"
export KUBECONFIG="$XDG_CONFIG_HOME/kube/config"
export PULUMI_HOME="$XDG_CONFIG_HOME/pulumi"

# brew shellenv
export HOMEBREW_PREFIX="/opt/homebrew";
export HOMEBREW_CELLAR="/opt/homebrew/Cellar";
export HOMEBREW_REPOSITORY="/opt/homebrew";

# Ensure that a non-login, non-interactive shell has a defined environment.
if [[ ( "$SHLVL" -eq 1 && ! -o LOGIN ) && -s "${ZDOTDIR}/.zprofile" ]]; then
  source "${ZDOTDIR}/.zprofile"
fi

# shortcut to this dotfiles path is $ZSH
export ZSH="$HOME/src/$username/dotfiles"
export DOTFILES="$HOME/src/$username/dotfiles"

# your project folder that we can `c [tab]` to
export PROJECTS="$HOME/src"

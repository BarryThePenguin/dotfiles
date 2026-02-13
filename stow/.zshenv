username="btp"

# utf-8 & screen
LC_ALL="en_US.UTF-8"

XDG_CONFIG_HOME="$HOME/.config"
XDG_CACHE_HOME="$HOME/.cache"
DOTNET_CLI_HOME="$XDG_CONFIG_HOME/dotnet"
GNUPGHOME="$XDG_CONFIG_HOME/gpg"
KUBECONFIG="$XDG_CONFIG_HOME/kube/config"
MISE_SOPS_AGE_KEY_FILE="$XDG_CONFIG_HOME/mise/age.txt"
PULUMI_HOME="$XDG_CONFIG_HOME/pulumi"
STARSHIP_CONFIG="$XDG_CONFIG_HOME/starship/starship.toml"
STARSHIP_CACHE="$XDG_CACHE_HOME/starship"
ZDOTDIR="$XDG_CONFIG_HOME/zsh"

# brew shellenv
HOMEBREW_PREFIX="/opt/homebrew";
HOMEBREW_CELLAR="/opt/homebrew/Cellar";
HOMEBREW_REPOSITORY="/opt/homebrew";

# Ensure that a non-login, non-interactive shell has a defined environment.
if [[ ( "$SHLVL" -eq 1 && ! -o LOGIN ) && -s "${ZDOTDIR}/.zprofile" ]]; then
  source "${ZDOTDIR}/.zprofile"
fi

# shortcut to this dotfiles path is $ZSH
ZSH="$HOME/src/$username/dotfiles"
DOTFILES="$HOME/src/$username/dotfiles"

EDITOR="code"
# your project folder that we can `c [tab]` to
PROJECTS="$HOME/src"

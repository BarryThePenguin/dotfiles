username="btp"

# utf-8 & screen
export LC_ALL="en_US.UTF-8"

export XDG_CONFIG_HOME="$HOME/.config"
export XDG_CACHE_HOME="$HOME/.cache"
export DOTNET_CLI_HOME="$XDG_CONFIG_HOME/dotnet"
export GNUPGHOME="$XDG_CONFIG_HOME/gpg"
export KUBECONFIG="$XDG_CONFIG_HOME/kube/config"
export MISE_SOPS_AGE_KEY_FILE="$XDG_CONFIG_HOME/mise/age.txt"
export PULUMI_HOME="$XDG_CONFIG_HOME/pulumi"
export STARSHIP_CONFIG="$XDG_CONFIG_HOME/starship/starship.toml"
export STARSHIP_CACHE="$XDG_CACHE_HOME/starship"
export ZDOTDIR="$XDG_CONFIG_HOME/zsh"
export ASPIRE_CONTAINER_RUNTIME="podman"

# brew shellenv
export HOMEBREW_PREFIX="/opt/homebrew";
export HOMEBREW_CELLAR="/opt/homebrew/Cellar";
export HOMEBREW_REPOSITORY="/opt/homebrew";

# Ensure that a non-login, non-interactive shell has a defined environment.
if [[ ( "$SHLVL" -eq 1 && ! -o LOGIN ) && -s "${ZDOTDIR}/.zprofile" ]]; then
  source "${ZDOTDIR}/.zprofile"
fi

# shortcut to this dotfiles path is $ZSH
export ZSH="$HOME/src/$username/dotfiles";
export DOTFILES="$HOME/src/$username/dotfiles";

export EDITOR="code";
export SOPS_EDITOR="code --wait --new-window --disable-workspace-trust --disable-extensions --disable-telemetry"
# your project folder that we can `c [tab]` to
export PROJECTS="$HOME/src"

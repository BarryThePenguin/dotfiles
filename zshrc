#
# Executes commands at the start of an interactive session.
#
# Authors:
#   Sorin Ionescu <sorin.ionescu@gmail.com>
#

###########################
#  Configuration
###########################

username="btp"

# if this ever breaks run "$ brew prefix <toolname>"
export PATH="$PATH:/usr/local/bin:/usr/local/sbin:/usr/bin:/bin:/usr/sbin:/sbin:/usr/X11/bin:/Users/$USER/.config/base16-shell"
export PATH="$PATH:/Users/$USER/Blake/$username/dotfiles/bin"
export PATH="$PATH:/Users/$USER/.config/base16-shell"
export PATH="/usr/local/opt/python@2/bin:$PATH"
export PATH="$PATH:/Users/$USER/.local/bin/"

# start zle
zmodload zsh/zle

# utf-8 & screen
export LC_ALL="en_US.UTF-8"
export TERM=screen-256color

# shortcut to this dotfiles path is $ZSH
export ZSH=$HOME/Blake/$username/dotfiles
export DOTFILES=$HOME/Blake/$username/dotfiles
export TEMPLATES=$HOME/Blake/$username/templates

# your project folder that we can `c [tab]` to
export PROJECTS=~/Blake

# source every .zsh file in this rep
for config_file ($ZSH/**/*.zsh) source $config_file

###########################
# Colors
###########################
# base-16
BASE16_SHELL="$HOME/.config/base16-shell/scripts/base16-eighties.sh"
if [ -s $BASE16_SHELL ]; then
  source $BASE16_SHELL
fi

###########################
#  Plugins
###########################
antigen bundle mafredri/zsh-async
antigen bundle sindresorhus/pure
antigen bundle marzocchi/zsh-notify
antigen bundle zsh-users/zsh-completions
antigen bundle zsh-users/zsh-syntax-highlighting
antigen bundle zsh-users/zsh-history-substring-search

# load autosuggest as last
antigen bundle tarruda/zsh-autosuggestions

antigen apply

# initialize autocomplete here, otherwise functions won't be loaded
autoload -Uz compinit && compinit
autoload -Uz promptinit && promptinit

prompt pure

for f in $ZSH/**/completion.sh; do
  source "$f"
done

# asdf
source $HOME/.asdf/asdf.sh

# default programs
export GHI_PAGER=less

# add gpg agent to every shell
if [ ! -S "$HOME/.gnupg/S.gpg-agent.ssh" ]; then
  gpg-agent --daemon >/dev/null 2>&1
  export GPG_TTY=$(tty)
fi

# kubernetes
if [ $commands[kubectl] ]; then
  source <(kubectl completion zsh)
fi

eval "$($HOME/Blake/bx/bin/bx init -)"
eval "$($HOME/Blake/bd/bin/bd init -)"
eval "$($HOME/Blake/bs/bin/bs init -)"
eval "$($HOME/Blake/blake-cloud/bin/bc init -)"

export PATH=$PATH:$HOME/Blake/bs/bin/

# tabtab source for serverless package
# uninstall by removing these lines or running `tabtab uninstall serverless`
[[ -f $HOME/Blake/nfd/v100it-lambdas/node_modules/tabtab/.completions/serverless.zsh ]] && . $HOME/Blake/nfd/v100it-lambdas/node_modules/tabtab/.completions/serverless.zsh
# tabtab source for sls package
# uninstall by removing these lines or running `tabtab uninstall sls`
[[ -f $HOME/Blake/nfd/v100it-lambdas/node_modules/tabtab/.completions/sls.zsh ]] && . $HOME/Blake/nfd/v100it-lambdas/node_modules/tabtab/.completions/sls.zsh
# tabtab source for slss package
# uninstall by removing these lines or running `tabtab uninstall slss`
[[ -f $HOME/Blake/nfd/v100it-lambdas/node_modules/tabtab/.completions/slss.zsh ]] && . $HOME/Blake/nfd/v100it-lambdas/node_modules/tabtab/.completions/slss.zsh

# bk8s shell setup
export PATH=$PATH:/Users/jonno/Blake/bk8s/bin/
source $HOME/Blake/bk8s/completions/bk.bash

export GOPATH=$HOME/go
PATH=$PATH:${GOPATH//://bin:}/bin

source $HOME/.asdf/completions/asdf.bash

eval "$(direnv hook zsh)"

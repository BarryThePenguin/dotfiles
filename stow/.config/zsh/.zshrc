#!/usr/bin/env zsh

###########################
#  Aliases
###########################

alias -s js=code
alias -s json=code
alias -s ts=code

alias reload!='exec zsh'

# IP addresses
alias ip="dig +short myip.opendns.com @resolver1.opendns.com"
alias localip="ipconfig getifaddr en0"
alias ips="ifconfig -a | grep -o 'inet6\? \(\([0-9]\+\.[0-9]\+\.[0-9]\+\.[0-9]\+\)\|[a-fA-F0-9:]\+\)' | sed -e 's/inet6* //'"

# Flush Directory Service cache
alias flush="dscacheutil -flushcache"

# Recursively delete `.DS_Store` files
alias ds_nomore="find . -type f -name '*.DS_Store' -ls -delete"

# Show/hide hidden files in Finder
alias show="defaults write com.apple.Finder AppleShowAllFiles -bool true && killall Finder"
alias hide="defaults write com.apple.Finder AppleShowAllFil es -bool false && killall Finder"

# Hide/show all desktop icons (useful when presenting)
alias hidedesktop="defaults write com.apple.finder CreateDesktop -bool false && killall Finder"
alias showdesktop="defaults write com.apple.finder CreateDesktop -bool true && killall Finder"

# from @nvie coderwall.com/p/4tkkpq
#
# ls **/*.zsh | map dirname
alias map="xargs -n1"

###########################
#  Scripts
###########################

path+="$DOTFILES/scripts"

# Tell me how slow my shell is
function timezsh() {
    shell=${1-$SHELL}
    for i in $(seq 1 10); do /usr/bin/time $shell -i -c exit; done
}

###########################
#  Source Prezto
###########################

source "$ZDOTDIR/.zprezto/init.zsh"
source "$XDG_CONFIG_HOME/base16-shell/scripts/base16-dracula.sh"

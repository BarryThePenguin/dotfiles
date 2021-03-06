#!/bin/bash

set -e

if [[ $SHELL != "/usr/local/bin/zsh" ]]; then
  echo "Changing Default Shell to ZSH"
  chsh -s /bin/zsh
fi

mkdir -p zsh/bundle
curl -L git.io/antigen \
  >  zsh/bundle/antigen.zsh

if [ ! -d ~/.config/base16-shell ]; then
  git clone https://github.com/chriskempson/base16-shell.git \
    ~/.config/base16-shell
fi

if [ ! -d ~/.config/dracula ]; then
  git clone https://github.com/dracula/zsh.git \
    ~/.config/dracula
fi

if [ ! -d ~/.asdf ]; then
  git clone https://github.com/asdf-vm/asdf.git \
    ~/.asdf \
    --branch v0.8.0
fi

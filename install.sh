#!/usr/bin/env bash

set -e

brew bundle --file stow/Brewfile # Install brew packages

git submodule sync --quiet --recursive
git submodule update --init --recursive

stow --verbose --restow --target ~ stow

asdf install

# Only use UTF-8 in Terminal.app
defaults write com.apple.terminal StringEncodings -array 4

# Install the Solarized Dark theme for iTerm
open "iterm/dracula/Dracula.itermcolors"

# Don’t display the annoying prompt when quitting iTerm
defaults write com.googlecode.iterm2 PromptOnQuit -bool false

# Save iTerm preferences to dotfiles
defaults write com.googlecode.iterm2 PrefsCustomFolder -string "$HOME/.config/iterm2/settings"

# Tell iTerm2 to use the custom preferences in the directory
defaults write com.googlecode.iterm2 LoadPrefsFromCustomFolder -bool true

#!/usr/bin/env bash

set -e

brew update
brew upgrade

git submodule sync --recursive
git submodule update --recursive

asdf update
asdf plugin update --all

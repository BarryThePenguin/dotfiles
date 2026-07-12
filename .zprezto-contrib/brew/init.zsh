# Include homebrew completions
if type brew &>/dev/null; then
  fpath+="$(brew --prefix)/share/zsh/site-functions"
fi

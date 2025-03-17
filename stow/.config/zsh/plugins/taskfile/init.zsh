# Include taskfile completions
if type brew &>/dev/null; then
  fpath+="$(brew --prefix go-task)/share/zsh/site-functions/_task"
fi

export PATH="${ASDF_DATA_DIR}/shims:$PATH"

if type brew &>/dev/null; then
  . <(asdf completion zsh)
fi

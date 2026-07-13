tap 'mongodb/brew'
tap "chmouel/lazyworktree", "https://github.com/chmouel/lazyworktree"

brew 'git'
brew 'jj'
brew 'mas'
brew 'mprocs'
brew 'terminal-notifier'
brew 'watchman'
brew 'xorriso'
brew 'yazi'
brew 'zsh'

cask '1password-cli'
cask '1password'
cask 'atuin-desktop'
cask 'bruno'
cask 'cyberduck'
cask 'dbeaver-community'
cask 'firefox@developer-edition'
cask 'flux-app'
cask 'font-fira-code-nerd-font'
cask 'ghostty'
cask 'github'
cask 'gpg-suite-no-mail'
cask 'keybase'
cask 'macpass'
cask 'podman-desktop'
cask 'todoist-app'
cask 'visual-studio-code'

mas "Boop", id: 1518425043
mas "CrystalFetch", id: 6454431289
mas "DaisyDisk", id: 411643860
mas "HazeOver", id: 430798174
mas "Magnet", id: 441258766
mas "The Unarchiver", id: 425424353
mas "Xcode", id: 497799835

profile = ENV.fetch("MISE_PROFILE", "personal")

if profile == "personal"
  cask 'copilot-cli'
  cask 'headlamp'
  cask 'notion'
  cask 'opencode-desktop'
  cask 'utm'
  cask 'zed'
end

if profile == "work"
  tap "showpad/gitlab", "git@gitlab.com:showpad-code/devops/homebrew.git", trusted: true

  brew "awscli"
  brew "bash"
  brew "fzf"
  brew "showpad/gitlab/assume-it", trusted: true
  brew "showpad/gitlab/connect-it", trusted: true

  cask "claude-code"
  cask "session-manager-plugin"

  mas "Okta Verify", id: 490179405
end

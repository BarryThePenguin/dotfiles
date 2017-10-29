setup_gitconfig () {
  if ! [ -f git/gitconfig.symlink ]; then
    echo 'setup gitconfig'

    echo ' - What is your github author name?'
    read -e git_authorname
    echo ' - What is your github author email?'
    read -e git_authoremail
    echo ' - What is your github GPG key ID?'
    read -e git_gpgkeyid

    sed -e "s/AUTHORNAME/$git_authorname/g" -e "s/AUTHOREMAIL/$git_authoremail/g" -e "s/GPGKEYID/$git_gpgkeyid/g" git/gitconfig.symlink.example > git/gitconfig.symlink

    echo 'gitconfig'
  fi
}

setup_gitconfig

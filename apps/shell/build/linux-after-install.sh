#!/bin/sh
# deb/rpm post-install: expose the ieumoffice command line shipped inside the app.
# Only an absent name, a dead link or a link into our own install dir is taken
# over; anything else at /usr/bin/ieumoffice belongs to another program (genoffice#893).
set -e
launcher="/opt/OfficeMax/resources/cli/ieumoffice"
link="/usr/bin/ieumoffice"
[ -x "$launcher" ] || exit 0
if [ -L "$link" ]; then
  case "$(readlink "$link")" in
    /opt/OfficeMax/*) ;;
    *) [ -e "$link" ] && { echo "ieumoffice: $link is another program, left as is; run: ln -s $launcher $link" >&2; exit 0; } ;;
  esac
elif [ -e "$link" ]; then
  echo "ieumoffice: $link is another program, left as is; run: ln -s $launcher $link" >&2
  exit 0
fi
ln -sfn "$launcher" "$link"
exit 0

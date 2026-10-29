package crawl

import (
	"net/url"
	"path"
	"strings"
)

// downloadExts are file extensions of things a page is never made of: archives, installers, disk images, pictures, audio,
// video, fonts and office formats the crawler does not read. The ones it reads (.pdf, .docx, .pptx, .md, .txt, HTML) and the
// ones a server may serve as readable text (.csv, .xml, .json) are not here.
var downloadExts = map[string]bool{
	// Archives and installers.
	".zip": true, ".gz": true, ".tgz": true, ".bz2": true, ".xz": true, ".zst": true, ".tar": true, ".7z": true, ".rar": true,
	".msi": true, ".pkg": true, ".exe": true, ".dmg": true, ".deb": true, ".rpm": true, ".apk": true, ".ipa": true, ".iso": true,
	".img": true, ".bin": true, ".jar": true, ".whl": true, ".appimage": true,
	// Pictures, audio, video and fonts.
	".png": true, ".jpg": true, ".jpeg": true, ".gif": true, ".webp": true, ".bmp": true, ".ico": true, ".tif": true, ".tiff": true,
	".heic": true, ".avif": true, ".svg": true, ".mp3": true, ".m4a": true, ".wav": true, ".flac": true, ".aac": true, ".ogg": true,
	".mp4": true, ".m4v": true, ".mov": true, ".avi": true, ".wmv": true, ".flv": true, ".webm": true, ".mkv": true,
	".woff": true, ".woff2": true, ".ttf": true, ".otf": true, ".eot": true,
	// Office formats the crawler does not read (.docx and .pptx it does).
	".doc": true, ".ppt": true, ".xls": true, ".xlsx": true, ".odt": true, ".ods": true, ".odp": true,
}

// IsDownload reports whether a URL's path names a file that is not a page the crawler can read (see downloadExts), so a
// link to it can be skipped without a request. Fetching it would cost a request spaced by the origin interval (a second by
// default) only to learn from the answer, or a download of the first megabytes, that it is unsupported: a page such as
// go.dev/dl lists thousands, and the run sat at "Running" for hours with "skipped" climbing by one a second (#132).
func IsDownload(rawURL string) bool {
	u, err := url.Parse(rawURL)
	if err != nil {
		return false
	}
	return downloadExts[strings.ToLower(path.Ext(u.Path))]
}

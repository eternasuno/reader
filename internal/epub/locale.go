package epub

import (
	"fmt"

	"reader/internal/domain"
)

// bookLocale is the book's primary language and the fixed text written in it.
type bookLocale struct {
	language     domain.KindleLanguage
	toc          string
	cover        string
	start        string
	untitled     string
	originalLink string
}

var bookLocales = map[domain.KindleLanguage]bookLocale{
	domain.KindleLanguageChinese: {
		language: domain.KindleLanguageChinese, toc: "目录", cover: "封面", start: "正文",
		untitled: "无标题", originalLink: "原文链接",
	},
	domain.KindleLanguageEnglish: {
		language: domain.KindleLanguageEnglish, toc: "Contents", cover: "Cover", start: "Start",
		untitled: "Untitled", originalLink: "Original article",
	},
	domain.KindleLanguageJapanese: {
		language: domain.KindleLanguageJapanese, toc: "目次", cover: "表紙", start: "本文",
		untitled: "無題", originalLink: "元の記事",
	},
}

func localeFor(language domain.KindleLanguage) (bookLocale, error) {
	locale, ok := bookLocales[language]
	if !ok {
		return bookLocale{}, fmt.Errorf("unsupported epub language %q", language)
	}

	return locale, nil
}

func (l bookLocale) htmlOpenTag() string {
	lang := string(l.language)

	return "<html xmlns=\"http://www.w3.org/1999/xhtml\" xmlns:epub=\"http://www.idpf.org/2007/ops\" xml:lang=\"" + lang + "\" lang=\"" + lang + "\">\n"
}

func (l bookLocale) coverPage() []byte {
	return []byte(xmlDeclaration + "<!DOCTYPE html>\n" + l.htmlOpenTag() + `<head>
<meta charset="utf-8"/>
<title>` + bookCreator + `</title>
<link rel="stylesheet" type="text/css" href="styles.css"/>
</head>
<body class="cover" epub:type="cover">
<img src="images/` + coverImageFileName + `" alt="` + bookCreator + `"/>
</body>
</html>
`)
}

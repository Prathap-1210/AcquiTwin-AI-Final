from __future__ import annotations

import re
from urllib.parse import urljoin

import requests
from bs4 import BeautifulSoup


URL = (
    "https://bhoomirashi.gov.in/auth/revamp/"
    "prep_public.cshtml?nid=1&project_id=22059"
)

HEADERS = {
    "User-Agent": "AcquiTwinAI/1.0 student-research"
}


def main():
    print("=" * 80)
    print("BHOOMI RASHI DETAIL-LINK INSPECTOR")
    print("=" * 80)

    response = requests.get(
        URL,
        headers=HEADERS,
        timeout=30,
        allow_redirects=True,
    )

    print("HTTP status :", response.status_code)
    print("Final URL   :", response.url)
    print("HTML length :", len(response.text))

    if response.status_code != 200:
        return

    soup = BeautifulSoup(
        response.text,
        "html.parser",
    )

    print("\n" + "=" * 80)
    print("VIEW DETAILS ELEMENTS")
    print("=" * 80)

    found = 0

    for element in soup.find_all(
        ["a", "button", "input", "span"]
    ):
        text = (
            element.get_text(
                " ",
                strip=True,
            )
            if element.name != "input"
            else element.get("value", "")
        )

        if "view details" not in text.lower():
            continue

        found += 1

        print(f"\n--- MATCH {found} ---")
        print("TAG       :", element.name)
        print("TEXT      :", text)
        print("HREF      :", element.get("href"))
        print("ONCLICK   :", element.get("onclick"))
        print("ID        :", element.get("id"))
        print("NAME      :", element.get("name"))
        print("VALUE     :", element.get("value"))
        print("DATA ATTR :", {
            key: value
            for key, value in element.attrs.items()
            if str(key).startswith("data-")
        })

        href = element.get("href")

        if href and not href.lower().startswith(
            ("javascript:", "#")
        ):
            print(
                "RESOLVED URL:",
                urljoin(
                    response.url,
                    href,
                ),
            )

        row = element.find_parent("tr")

        if row:
            print("\nPARENT ROW:")
            print(
                row.get_text(
                    " | ",
                    strip=True,
                )
            )

            print("\nROW HTML:")
            print(str(row)[:4000])

    print("\nMatches:", found)

    print("\n" + "=" * 80)
    print("CSHTML LINKS FOUND IN PAGE")
    print("=" * 80)

    candidates = set()

    # Normal hyperlinks.
    for anchor in soup.find_all(
        "a",
        href=True,
    ):
        href = anchor.get("href")

        if ".cshtml" in href.lower():
            candidates.add(
                urljoin(
                    response.url,
                    href,
                )
            )

    # URLs embedded in JavaScript/onclick.
    patterns = [
        r"""['"]([^'"]+\.cshtml\?[^'"]+)['"]""",
        r"""['"]([^'"]+\.cshtml)['"]""",
    ]

    for pattern in patterns:
        for match in re.findall(
            pattern,
            response.text,
            flags=re.IGNORECASE,
        ):
            candidates.add(
                urljoin(
                    response.url,
                    match,
                )
            )

    for index, candidate in enumerate(
        sorted(candidates),
        start=1,
    ):
        print(
            f"{index}. {candidate}"
        )

    print(
        "\nTotal CSHTML candidates:",
        len(candidates),
    )


if __name__ == "__main__":
    main()
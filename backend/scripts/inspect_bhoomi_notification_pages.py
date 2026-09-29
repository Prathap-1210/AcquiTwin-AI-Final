from __future__ import annotations

import time

import requests
from bs4 import BeautifulSoup


URLS = [
    (
        "CALA / 3A",
        "https://bhoomirashi.gov.in/auth/revamp/"
        "calavil.cshtml?"
        "project_id=22059"
        "&EncHid="
        "&notification_id=22118"
        "&nid=9"
    ),

    (
        "3A DETAILS",
        "https://bhoomirashi.gov.in/auth/revamp/"
        "sdet.cshtml?"
        "project_id=22059"
        "&EncHid="
        "&notification_id=27039"
        "&nid=9"
    ),

    (
        "3D DETAILS",
        "https://bhoomirashi.gov.in/auth/revamp/"
        "sdet1.cshtml?"
        "project_id=22059"
        "&EncHid="
        "&notification_id=18023"
        "&nid=9"
    ),
]


HEADERS = {
    "User-Agent": (
        "AcquiTwinAI/1.0 "
        "student-research"
    )
}


def clean(value: str) -> str:
    return " ".join(
        value.split()
    )


def inspect_page(
    label: str,
    url: str,
) -> None:

    print("\n")
    print("=" * 100)
    print(label)
    print("=" * 100)

    print("URL:")
    print(url)

    try:
        response = requests.get(
            url,
            headers=HEADERS,
            timeout=30,
            allow_redirects=True,
        )

    except requests.RequestException as exc:
        print(
            "REQUEST ERROR:",
            exc,
        )
        return

    print(
        "HTTP:",
        response.status_code
    )

    print(
        "FINAL URL:",
        response.url
    )

    print(
        "HTML LENGTH:",
        len(response.text)
    )

    if response.status_code != 200:
        return

    soup = BeautifulSoup(
        response.text,
        "html.parser",
    )

    # ========================================================
    # PAGE TITLE
    # ========================================================

    print("\nPAGE TITLE")

    if soup.title:
        print(
            clean(
                soup.title.get_text(
                    " ",
                    strip=True,
                )
            )
        )
    else:
        print(
            "No HTML title"
        )

    # ========================================================
    # HEADINGS
    # ========================================================

    print("\nHEADINGS")

    headings_found = 0

    for heading in soup.find_all(
        [
            "h1",
            "h2",
            "h3",
            "h4",
            "h5",
            "legend",
        ]
    ):

        text = clean(
            heading.get_text(
                " ",
                strip=True,
            )
        )

        if not text:
            continue

        headings_found += 1

        print(
            f"{headings_found}. {text}"
        )

    if headings_found == 0:
        print(
            "No headings found."
        )

    # ========================================================
    # TABLES
    # ========================================================

    tables = soup.find_all(
        "table"
    )

    print(
        "\nTABLE COUNT:",
        len(tables)
    )

    for table_index, table in enumerate(
        tables,
        start=1,
    ):

        print("\n")
        print("-" * 100)

        print(
            f"TABLE {table_index}"
        )

        print("-" * 100)

        rows = table.find_all(
            "tr"
        )

        print(
            "ROWS:",
            len(rows)
        )

        # Print up to first 30 rows.
        for row_index, row in enumerate(
            rows[:30],
            start=1,
        ):

            cells = row.find_all(
                [
                    "th",
                    "td",
                ]
            )

            values = [
                clean(
                    cell.get_text(
                        " ",
                        strip=True,
                    )
                )
                for cell in cells
            ]

            values = [
                value
                for value in values
                if value
            ]

            if not values:
                continue

            print(
                f"ROW {row_index}:"
            )

            print(
                " | ".join(
                    values
                )
            )

    # ========================================================
    # SEARCH IMPORTANT TERMS
    # ========================================================

    page_text = clean(
        soup.get_text(
            " ",
            strip=True,
        )
    )

    important_terms = [
        "Village",
        "District",
        "Tehsil",
        "Taluka",
        "Taluk",
        "State",
        "Land",
        "Survey",
        "Plot",
        "Notification",
    ]

    print("\n")
    print("=" * 100)
    print("IMPORTANT TERM CHECK")
    print("=" * 100)

    lower_text = (
        page_text.lower()
    )

    for term in important_terms:

        found = (
            term.lower()
            in lower_text
        )

        print(
            f"{term:15}:",
            "YES"
            if found
            else
            "NO"
        )

    # ========================================================
    # TEXT AROUND "VILLAGE"
    # ========================================================

    keyword = "village"

    position = lower_text.find(
        keyword
    )

    if position >= 0:

        start = max(
            0,
            position - 500,
        )

        end = min(
            len(page_text),
            position + 1500,
        )

        print("\n")
        print("=" * 100)
        print("TEXT AROUND 'VILLAGE'")
        print("=" * 100)

        print(
            page_text[
                start:end
            ]
        )

    # ========================================================
    # FORM CONTROLS
    # ========================================================

    print("\n")
    print("=" * 100)
    print("SELECT / INPUT VALUES")
    print("=" * 100)

    selects = soup.find_all(
        "select"
    )

    print(
        "SELECTS:",
        len(selects)
    )

    for select in selects:

        print(
            "\nSELECT:",
            select.get("name"),
            select.get("id"),
        )

        for option in select.find_all(
            "option"
        )[:20]:

            text = clean(
                option.get_text(
                    " ",
                    strip=True,
                )
            )

            value = (
                option.get(
                    "value"
                )
            )

            print(
                "   ",
                value,
                "=>",
                text,
            )

    inputs = soup.find_all(
        "input"
    )

    print(
        "\nINPUTS:",
        len(inputs)
    )

    for item in inputs[:30]:

        print(
            "INPUT",
            "name=",
            item.get("name"),
            "id=",
            item.get("id"),
            "value=",
            item.get("value"),
            "type=",
            item.get("type"),
        )


def main() -> None:

    print(
        "=" * 100
    )

    print(
        "BHOOMI RASHI NOTIFICATION PAGE INSPECTOR"
    )

    print(
        "=" * 100
    )

    for label, url in URLS:

        inspect_page(
            label,
            url,
        )

        # Be gentle with government portal.
        time.sleep(
            1.5
        )


if __name__ == "__main__":
    main()
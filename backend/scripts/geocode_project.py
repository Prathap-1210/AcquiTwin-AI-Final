import time
import requests


HEADERS = {
    "User-Agent": "AcquiTwinAI/1.0"
}


def geocode_place(place: str):
    url = "https://nominatim.openstreetmap.org/search"

    params = {
        "q": place,
        "format": "json",
        "limit": 1,
        "countrycodes": "in",
    }

    response = requests.get(
        url,
        params=params,
        headers=HEADERS,
        timeout=20,
    )

    response.raise_for_status()

    results = response.json()

    if not results:
        return None

    result = results[0]

    return {
        "latitude": float(result["lat"]),
        "longitude": float(result["lon"]),
        "display_name": result["display_name"],
    }


places = [
    "Pindwara, Rajasthan, India",
    "Kotra, Udaipur, Rajasthan, India",
    "Jhadol, Udaipur, Rajasthan, India",
    "Kherwara, Udaipur, Rajasthan, India",
    "Sagwara, Dungarpur, Rajasthan, India",
    "Banswara, Rajasthan, India",
]


locations = []

for place in places:

    result = geocode_place(place)

    if result:
        print(place)
        print(result)

        locations.append(result)

    # Public Nominatim should be rate limited.
    time.sleep(1.1)


if not locations:
    raise RuntimeError(
        "No valid project locations found."
    )


latitude = sum(
    item["latitude"]
    for item in locations
) / len(locations)

longitude = sum(
    item["longitude"]
    for item in locations
) / len(locations)


print("\nRepresentative project coordinate:")
print("Latitude :", latitude)
print("Longitude:", longitude)
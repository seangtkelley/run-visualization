import sys
import json
import datetime as dt
import xml.etree.ElementTree

import pandas as pd
from shapely.geometry import Point, shape
import pyproj
import requests

from flask import Flask
from flask import render_template

project_path = '/home/sean/Documents/experiments/personal-health-tracking'
sys.path.append(project_path)

from lib import custom_utils

_GEOD = pyproj.Geod(ellps='WGS84')

data_path = project_path+'/data/01-runkeeper-data-export-2019-01-09-162557'

# source: https://stackoverflow.com/questions/20169467/how-to-convert-from-longitude-and-latitude-to-country-or-city
def get_town(lat, lon):
    key = "AIzaSyBKPPv_NQDWEjIabqcSCKMlh9BfXhjfv94"
    url = "https://maps.googleapis.com/maps/api/geocode/json?"
    url += "latlng=%s,%s&sensor=false&key=%s" % (lat, lon, key)
    v = requests.get(url)
    j = json.loads(v.text)
    components = j['results'][0]['address_components']
    town = state = None
    for c in components:
        if "locality" in c['types']:
            town = c['long_name']
        elif "administrative_area_level_1" in c['types']:
            state = c['short_name']

    return town+', '+state if state else "Unknown"

app = Flask(__name__)

@app.route("/")
def index():
    return render_template("index.html")

@app.route("/data")
def get_data():
    runkeeper_runs = pd.read_csv(data_path+'/cardioActivities.csv', parse_dates=[1])

    # ignore runs with invalid pace
    runkeeper_runs = runkeeper_runs.dropna(subset=['Average Pace'])

    # convert duration strings to timedeltas
    runkeeper_runs['Average Pace'] = runkeeper_runs['Average Pace'].apply(custom_utils.duration_to_delta)
    runkeeper_runs['Duration'] = runkeeper_runs['Duration'].apply(custom_utils.duration_to_delta)

    # add column with pace in seconds
    runkeeper_runs['avg_pace_secs'] = runkeeper_runs['Average Pace'].dt.total_seconds()

    # ignore crazy outliers with pace >15 minutes (I sometimes forget to end the run)
    runkeeper_runs = runkeeper_runs[runkeeper_runs['avg_pace_secs']/60 < 15].reset_index()

    all_points = []
    for i, gpx_filename in enumerate(runkeeper_runs['GPX File']):
        # build path
        gpx_filepath = data_path+'/'+gpx_filename
        
        # load gpx
        root = xml.etree.ElementTree.parse(gpx_filepath).getroot()
        
        # get loop through all points
        location = ""
        points = []
        for trkseg in root[0].findall('{http://www.topografix.com/GPX/1/1}trkseg'):
            for point in trkseg:
                # get data from point
                lat, lon = float(point.get('lat')), float(point.get('lon'))
                ele = float(point[0].text)
                timestamp = dt.datetime.strptime(point[1].text, '%Y-%m-%dT%H:%M:%SZ')
                
                if not points:
                    v = 0
                    location = get_town(lat, lon)
                    #location = "Unknown"
                else:
                    # calculate distance
                    # Source: https://stackoverflow.com/questions/24968215/python-calculate-speed-distance-direction-from-2-gps-coordinates
                    try:
                        # inv returns azimuth, back azimuth and distance
                        _, _ , d = _GEOD.inv(points[-1]['lon'], points[-1]['lat'], lon, lat) 
                    except:
                        raise ValueError("Invalid MGRS point")
                    
                    # calculate time different
                    t = ( (timestamp - points[-1]['timestamp']).total_seconds() )
                    
                    # calculate speed (m/s)
                    if t == 0:
                        continue
                        
                    v = d / t
                    
                # append point
                points.append({
                    'lat': lat,
                    'lon': lon,
                    'ele': ele,
                    'location': location,
                    'timestamp': timestamp,
                    'speed': v,
                    'run_avg_pace': runkeeper_runs.iloc[i]['avg_pace_secs'],
                    'run_distance': runkeeper_runs.iloc[i]['Distance (mi)'],
                    'run_duration': runkeeper_runs.iloc[i]['Duration'].total_seconds()
                })

        # add this run's points to all points
        all_points.extend(points)
    
    all_points = pd.DataFrame(all_points).dropna()

    # convert timestamp to EST and subsequently string for javascript
    all_points['timestamp'] = (all_points['timestamp'].dt.tz_localize('UTC').dt.tz_convert('US/Eastern'))
    all_points['hour'] = all_points['timestamp'].dt.hour
    all_points['dow'] = all_points['timestamp'].dt.dayofweek
    all_points['timestamp'] = all_points['timestamp'].dt.strftime("%Y-%m-%d %H:%M:%S")

    # get points where I'm most likely running: 1 std dev away from mean
    mean = all_points.speed.mean()
    std = all_points.speed.std()

    valid_points = all_points[(all_points.speed > (mean - 1*std)) & (all_points.speed < (mean + 1*std))]

    return valid_points.to_json(orient='records')


if __name__ == "__main__":
    app.run(host='0.0.0.0',port=5000,debug=True)
import sys
import json
import datetime as dt
import xml.etree.ElementTree

import numpy as np
import pandas as pd
from shapely.geometry import Point, shape
import pyproj
import requests
from colour import Color

from flask import Flask, Response
from flask import render_template

project_path = '/home/sean/Documents/experiments/personal-health-tracking'
sys.path.append(project_path)

from lib import custom_utils

_GEOD = pyproj.Geod(ellps='WGS84')

data_path = project_path+'/data/01-runkeeper-data-export-2019-01-09-162557'

color_range = list(Color("blue").range_to(Color("green"), 5)) + list(Color("green").range_to(Color("yellow"), 5))[1:] + list(Color("yellow").range_to(Color("red"), 5))[1:]
color_range = [c.hex for c in color_range]

# source: https://stackoverflow.com/questions/20169467/how-to-convert-from-longitude-and-latitude-to-country-or-city
def get_town(lat, lon):
    with open('../keys.json', 'r') as f:
        keys = json.loads(f.read())
    url = "https://maps.googleapis.com/maps/api/geocode/json?"
    url += "latlng=%s,%s&sensor=false&key=%s" % (lat, lon, keys['google_geocoding_api_key'])
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

def round_base(x, base=5):
    return int(base * round(float(x)/base))

app = Flask(__name__)

@app.route("/")
def index():
    return render_template("index.html")

@app.route("/data/load")
def data_load():
    try:
        data = pd.read_csv('./data/run_data.csv')
        return data.to_json(orient='records')
    except FileNotFoundError:
        # Keep preset values
        return Response("{'error':'data not generated'}", status=404, mimetype='application/json')

@app.route("/data/generate")
def data_generate():
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
                    # location = "Unknown"
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
                    'run_avg_pace': runkeeper_runs.iloc[i]['avg_pace_secs']/60,
                    'run_distance': runkeeper_runs.iloc[i]['Distance (mi)'],
                    'run_duration': runkeeper_runs.iloc[i]['Duration'].total_seconds()/60
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

    min_speed, max_speed = valid_points['speed'].min(), valid_points['speed'].max()
    incr = (max_speed - min_speed)/len(color_range)
    bins = np.arange(min_speed, max_speed, incr)
    valid_points['color'] = pd.cut(valid_points['speed'], bins=bins, labels=color_range)

    # convert numerical values to categorical for better graphs
    valid_points['run_avg_pace'] = pd.cut(valid_points['run_avg_pace'], bins=pd.interval_range(start=round_base(valid_points['run_avg_pace'].min()-5), end=round_base(valid_points['run_avg_pace'].max()+5), freq=0.5))
    valid_points['run_distance'] = pd.cut(valid_points['run_distance'], bins=pd.interval_range(start=np.floor(valid_points['run_distance'].min()), end=np.ceil(valid_points['run_distance'].max()), freq=1))
    valid_points['run_duration'] = pd.cut(valid_points['run_duration'], bins=pd.interval_range(start=round_base(valid_points['run_duration'].min()-5), end=round_base(valid_points['run_duration'].max()+5), freq=5))

    # save file
    valid_points.to_csv('./data/run_data.csv')

    return Response("{'success':'data generated successfully.'}", status=200, mimetype='application/json')


if __name__ == "__main__":
    app.run(host='0.0.0.0',port=5000,debug=True)
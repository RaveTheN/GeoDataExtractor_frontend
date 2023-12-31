import { HttpClient, HttpHeaders } from "@angular/common/http";
import { Injectable } from "@angular/core";
import { environment } from "../../environments/environment";
import * as L from "leaflet";
import * as turf from "@turf/turf";
import { MarkerClusterGroup } from "leaflet.markercluster";
import { BehaviorSubject, Subject } from "rxjs";
import { takeUntil } from "rxjs/operators";
// import "leaflet.markercluster/dist/MarkerCluster.Default.css";
// import "leaflet/dist/leaflet.css";

@Injectable({
  providedIn: "root",
})
export class ApiService {
  customIcon = L.icon({
    iconSize: [25, 41],
    iconAnchor: [10, 41],
    popupAnchor: [2, -40],
    // specify the path here
    iconUrl:
      "https://upload.wikimedia.org/wikipedia/commons/8/88/Map_marker.svg",
    shadowUrl: "https://unpkg.com/leaflet@1.4.0/dist/images/marker-shadow.png",
  });

  constructor(private http: HttpClient) {}

  //store drawn layers here
  public storedLayers = [];

  //Stores the points to be passed to create-layer.component
  apiPoints = {};

  //store here all the projects info retrieved with the call getAll
  allProjects = [];

  //these are all the variables and the function that are needed to control the progress bar when receiving points
  nominalProgress = 0;
  totalProgress = 0;
  private progressSource = new BehaviorSubject<number>(0);
  progress$ = this.progressSource.asObservable();
  setProgress(value: number) {
    this.progressSource.next(value);
  }

  //use this variable and the funtion to unsubscribe from requests' response
  protected ngUnsubscribe: Subject<void> = new Subject<void>();
  public ngOnDestroy(): void {
    // This aborts all HTTP requests.
    this.ngUnsubscribe.next();
    // This completes the subject properlly.
    this.ngUnsubscribe.complete();
  }

  /**
   * Sets apiFilters with the data provided by getFilters().
   * @param data - An array of filter data to set.
   */

  /**
   * Retrieves filters for a specific city from Orion.
   * @param cityValue - The city for which filters are requested.
   * @returns A Promise that resolves with the retrieved filters.
   */
  public getFilters(cityValue: string) {
    return new Promise((resolve, reject) => {
      const url = `${environment.base_url}/api/filter/`;
      this.http
        .post(url, JSON.stringify({ city: cityValue }), {
          headers: new HttpHeaders({
            "Content-Type": "application/json",
          }),
          responseType: "text",
        })
        .pipe(takeUntil(this.ngUnsubscribe))
        .subscribe(
          (data) => {
            // Clean up the data and split it into an array
            const cleanData = data.replace(/[\[\],]/g, "");
            const dataArray = cleanData.split(" ");

            // Set the filters and resolve the Promise with the filter data
            resolve(dataArray);
          },
          (error) => {
            console.log(error);
            if (
              error.status === 400 ||
              error.error.text === "Request retrieved"
            )
              // Resolve with an error message if the request is successful but contains an error message
              resolve(error.error.text);
            // Reject the Promise with the error
            else reject(error);
          }
        );
    });
  }

  /**
   * Retrieves polygon data for specified filters and adds markers to the map.
   * @param body - An object containing city, and filter data.
   */
  public getPolygonData(body: { city: string; filter: string[] }) {
    //empty the array in which to put the triangles from polygons tesselation
    let tesselationResults = [];
    //set the percentage of which the progress bar will advance for each response we get
    this.nominalProgress = 100 / this.storedLayers.length / body.filter.length;
    return new Promise(async (resolve, reject) => {
      //for every filter
      for (const filter of body.filter) {
        //create a key in the apiPoint object, if it doesnt exist
        if (!this.apiPoints[filter]) {
          this.apiPoints[filter] = new MarkerClusterGroup();
        }
        const url = `${environment.base_url}/api/multipolygondata/`;

        //for each drawing stored
        for (const layer of this.storedLayers) {
          tesselationResults = [];
          //if they are not circles
          if (!layer.properties.radius) {
            let isPolygon = true;
            let isCircle = true;
            let poly = turf.polygon(layer.geometry.coordinates);
            //calculate centroid of the polygon (if it is a circle will match the center)
            let centroid = turf.centroid(poly);
            //calculate the distance between first vertex and the centrooid (if it is a circle, this will be the equivalent of the radius)
            let from = turf.point(layer.geometry.coordinates[0][1]);
            let to = turf.point(centroid.geometry.coordinates);
            let options: { units: turf.Units } = { units: "kilometers" };
            let radius = turf.distance(from, to, options) * 1000;

            //if they have more than 20 vertices
            if (layer.geometry.coordinates[0].length > 20) {
              //for every vertex
              for (let coordinate of layer.geometry.coordinates[0]) {
                let from = turf.point(coordinate);
                let distance = turf.distance(from, to, options) * 1000;

                //if the distance exceeds or is smaller than the radius with a tolerance of 1 meter
                if (distance > radius + 1 || distance < radius - 1) {
                  //then it is not a circle
                  isCircle = false;
                } else {
                  isPolygon = false;
                }
              }
            }

            if (isCircle && !isPolygon) {
              this.http
                .post<any>(
                  `${environment.base_url}/api/multipointradiusdata/`,
                  {
                    city: body.city,
                    filter: [filter],
                    multipoint: [
                      {
                        point: {
                          //MIND: coordinates inside the geometry I have received so fare are inverted.
                          latitude: centroid.geometry.coordinates[1],
                          longitude: centroid.geometry.coordinates[0],
                        },
                        radius: radius,
                        external: false,
                      },
                    ],
                  },
                  {
                    headers: new HttpHeaders({
                      "Content-Type": "application/json",
                      "Access-Control-Allow-Origin": "*",
                      "Access-Control-Allow-Methods": "POST,PATCH,OPTIONS",
                    }),
                  }
                )
                .pipe(takeUntil(this.ngUnsubscribe))
                .subscribe(
                  (data) => {
                    //data is a featureCollection
                    resolve(
                      data.forEach((element) => {
                        element.features
                          .map((element: any) =>
                            element.geometry === null
                              ? L.marker(
                                  [
                                    element.properties.location.value
                                      .coordinates[1],
                                    element.properties.location.value
                                      .coordinates[0],
                                  ],
                                  {
                                    icon: this.customIcon,
                                  }
                                ).bindPopup(`${element.properties.type}`)
                              : L.marker(
                                  [
                                    element.geometry.coordinates[1],
                                    element.geometry.coordinates[0],
                                  ],
                                  {
                                    icon: this.customIcon,
                                  }
                                  //message to show inside the popup when clicking a marker
                                ).bindPopup(`${element.properties.type}`)
                          )
                          .forEach((element) =>
                            //add the marker (which is a layer) in the markergroup stored with the name of the filter
                            element.addTo(this.apiPoints[filter])
                          );
                      })
                    );
                    //add the percentage of progress every time it gets a response (to make the bar change, this is listened inside the frontend component)
                    this.totalProgress += this.nominalProgress;
                    this.setProgress(this.totalProgress);
                  },
                  (error) => {
                    console.log(error);
                    if (
                      error.status === "200" ||
                      error.error.text === "Request retrieved"
                    )
                      resolve(error.error.text);
                    else reject(error);
                  }
                );
            } else {
              //it goes here if it is not a circle of any kind: real or made with smaller polygons
              //tesselate is the functions that simplifies a polygon into a featureCollection of smaller triangles
              var triangles = turf.tesselate(poly);
              //for every triangle odf the feature
              let feature: any;
              for (feature of triangles.features) {
                let polygonArray = [];
                // Flatten the nested array and push edges to the polygon array
                for (const coordinate of feature.geometry.coordinates.flat()) {
                  const edge = {
                    latitude: coordinate[1],
                    longitude: coordinate[0],
                  };
                  //polygonArray contains all the triangles mapped with latitude and longitude
                  polygonArray.push(edge);
                }
                //stores the result of the above process and it is now ready to be used in the http call
                tesselationResults.push(polygonArray);
              }
              this.http
                .post<any>(
                  url,
                  {
                    city: body.city,
                    filter: [filter],
                    polygon: tesselationResults,
                  },
                  {
                    headers: new HttpHeaders({
                      "Content-Type": "application/json",
                      "Access-Control-Allow-Origin": "*",
                      "Access-Control-Allow-Methods": "POST,PATCH,OPTIONS",
                    }),
                  }
                )
                .pipe(takeUntil(this.ngUnsubscribe))
                .subscribe(
                  (data) => {
                    //data is a featureCollection
                    resolve(
                      data.forEach((element) => {
                        element.features
                          .map((element: any) =>
                            element.geometry === null
                              ? L.marker(
                                  [
                                    element.properties.location.value
                                      .coordinates[1],
                                    element.properties.location.value
                                      .coordinates[0],
                                  ],
                                  {
                                    icon: this.customIcon,
                                  }
                                ).bindPopup(`${element.properties.type}`)
                              : L.marker(
                                  [
                                    element.geometry.coordinates[1],
                                    element.geometry.coordinates[0],
                                  ],
                                  {
                                    icon: this.customIcon,
                                  }
                                ).bindPopup(`${element.properties.type}`)
                          )
                          .forEach((element) =>
                            element.addTo(this.apiPoints[filter])
                          );
                      })
                    );
                    //add the percentage of progress every time it gets a response (to make the bar change, this is listened inside the frontend component)
                    this.totalProgress += this.nominalProgress;
                    this.setProgress(this.totalProgress);
                  },
                  (error) => {
                    console.log(error);
                    if (
                      error.status === "200" ||
                      error.error.text === "Request retrieved"
                    )
                      resolve(error.error.text);
                    else reject(error);
                  }
                );
            }
          }
        }
      }
    });
  }

  /**
   * Retrieves circle data for specified filters and adds markers to the map.
   * @param body - An object containing city, filter, point, radius end external.
   * external - means whether to search inside or outside the shape.
   */
  public getPointRadiusData(body: any): any {
    //set the percentage of which the progress bar will advance for each response we get
    this.nominalProgress = 100 / this.storedLayers.length / body.filter.length;
    return new Promise((resolve, reject) => {
      //cycling once for each voice inside body.filter
      for (const filter of body.filter) {
        //making a new key in apiPoint with the name of the current filter, if it doesn't exist
        this.apiPoints[filter]
          ? null
          : (this.apiPoints[filter] = new MarkerClusterGroup());
        const url = `${environment.base_url}/api/multipointradiusdata/`;
        this.http
          .post<any>(
            url,
            {
              city: body.city,
              filter: [filter],
              multipoint: body.multipoint,
            },
            {
              headers: new HttpHeaders({
                "Content-Type": "application/json",
                "Access-Control-Allow-Origin": "*",
                "Access-Control-Allow-Methods": "POST,PATCH,OPTIONS",
              }),
            }
          )
          .pipe(takeUntil(this.ngUnsubscribe))
          .subscribe(
            (data) => {
              resolve(
                data.forEach((element) => {
                  element.features
                    .map((element: any) =>
                      element.geometry === null
                        ? L.marker(
                            [
                              element.properties.location.value.coordinates[1],
                              element.properties.location.value.coordinates[0],
                            ],
                            {
                              icon: this.customIcon,
                            }
                          ).bindPopup(`${element.properties.type}`)
                        : L.marker(
                            [
                              element.geometry.coordinates[1],
                              element.geometry.coordinates[0],
                            ],
                            {
                              icon: this.customIcon,
                            }
                          ).bindPopup(`${element.properties.type}`)
                    )
                    .forEach((element) =>
                      element.addTo(this.apiPoints[filter])
                    );

                  this.totalProgress += this.nominalProgress;
                  this.setProgress(this.totalProgress);
                })
              );
            },
            (error) => {
              console.log(error);
              if (
                error.status === "200" ||
                error.error.text === "Request retrieved"
              )
                resolve(error.error.text);
              else reject(error);
            }
          );
      }
    });
  }

  public async saveSearch(queryDetails: any) {
    return new Promise((resolve, reject) => {
      //resets the array in which to store each feature, that will then be stored inside the key "features" of the geojson object of the stored data
      let featuresArray = [];
      for (const filter of queryDetails.filters) {
        //extracting coordinates from apiPoints (which contains all the points obtained from the last search)
        //in alternative to apiPoints I could use overlayMaps from create-layer, which after a research contains the same data of apiPoints
        let coordinates = [];
        for (let layer of this.apiPoints[filter].getLayers()) {
          coordinates.push([layer.getLatLng().lat, layer.getLatLng().lng]);
        }
        featuresArray.push(
          Object({
            type: "Feature",
            geometry: {
              type: "Point",
              coordinates: [coordinates],
            },
            properties: {
              name: filter,
            },
          })
        );
      }
      const url = `${environment.base_url}/api/document/save/`;
      const body = {
        city: queryDetails.city,
        filter: queryDetails.filters,
        name: queryDetails.queryName,
        description: queryDetails.queryDescription,
        layers: queryDetails.layers,
        requestJson: {
          type: "Polygon/PointRadius/Multipolygon",
          value: queryDetails,
        },
        geojson: {
          type: "Feature",
          features: featuresArray,
        },
      };
      this.http
        .post(url, body, {
          headers: new HttpHeaders({
            Authorization:
              "eyJhbGciOiJSUzI1NiIsInR5cCIgOiAiSldUIiwia2lkIiA6ICJCQUpfRm04T0tOdXlBaXB2MTA5VElsOENpdHpxWGlSR0FCUHI2NWx4M2c0In0.eyJleHAiOjE2ODMwMzIwOTYsImlhdCI6MTY4MzAzMTc5NiwiYXV0aF90aW1lIjoxNjgzMDMxNzk1LCJqdGkiOiJmNjZlYzg3MC1mMWM5LTQxM2UtODZiZS05ODU3ZGNlZjFlNGQiLCJpc3MiOiJodHRwOi8vbG9jYWxob3N0OjgwODUvYXV0aC9yZWFsbXMvU3BvdHRlZCIsImF1ZCI6ImFjY291bnQiLCJzdWIiOiJmNjIzYTUwNi1mODAzLTQ5NjktYTVhMi01Yjk4MjU2NDMxNjciLCJ0eXAiOiJCZWFyZXIiLCJhenAiOiJzcG90dGVkIiwic2Vzc2lvbl9zdGF0ZSI6IjBmMDk3ZTExLTZmYjUtNGNhZC1iZDkzLTMwNjA5ZDZmMmQ3NiIsImFjciI6IjEiLCJhbGxvd2VkLW9yaWdpbnMiOlsiKiJdLCJyZWFsbV9hY2Nlc3MiOnsicm9sZXMiOlsib2ZmbGluZV9hY2Nlc3MiLCJkZWZhdWx0LXJvbGVzLXNwb3R0ZWQiLCJ1bWFfYXV0aG9yaXphdGlvbiJdfSwicmVzb3VyY2VfYWNjZXNzIjp7ImFjY291bnQiOnsicm9sZXMiOlsibWFuYWdlLWFjY291bnQiLCJtYW5hZ2UtYWNjb3VudC1saW5rcyIsInZpZXctcHJvZmlsZSJdfX0sInNjb3BlIjoib3BlbmlkIGVtYWlsIHByb2ZpbGUiLCJzaWQiOiIwZjA5N2UxMS02ZmI1LTRjYWQtYmQ5My0zMDYwOWQ2ZjJkNzYiLCJlbWFpbF92ZXJpZmllZCI6ZmFsc2UsIm5hbWUiOiJSaXRhIEdhZXRhIiwicHJlZmVycmVkX3VzZXJuYW1lIjoicml0YS5nYWV0YUBlbmcuaXQiLCJnaXZlbl9uYW1lIjoiUml0YSIsImZhbWlseV9uYW1lIjoiR2FldGEiLCJlbWFpbCI6InJpdGEuZ2FldGFAZW5nLml0In0.RVBSlrsLL7TRNSxEEXkP1F0RX0cw7cwEbVHPJg9-MNzYzWHDQJE0wDqFgL2u_d_E2I9B1vu5tLbL0pEEUnmnzj5cIsIz4eP2uGbq-0wIG08Xf3eZLQjd8ZvsIact5u_L_Cs400OUMVOsUyuq-B9k39_HevsaMbHIzHpaXiWKur6J77KzIcbg-UQ5sfq11HZMkrZnxNnHWvBJxdzV-ZQiD7Lav-_AGb32ZQ0zIb5sQ2LE-CI2_531LNjXOcHu8vG6wNarJ9XZgFeXfToe9W_y1LFJ1vJbv1RvIazZiXhJlCULbZ1XI0hP-lW1PAi3XonMKcVcT1B6EiGWQy2x3CqzGg",
            "Content-Type": "application/json",
          }),
          responseType: "text",
        })
        .pipe(takeUntil(this.ngUnsubscribe))
        .subscribe((data) => {
          resolve(data);
        }),
        (error) => {
          console.log(error);
          if (error.status === 400 || error.error.text === "Request retrieved")
            // Resolve with an error message if the request is successful but contains an error message
            resolve(error.error.text);
          // Reject the Promise with the error
          else reject(error);
        };
    });
  }

  /**
   * This function performs a search for documents based on the provided IDs.
   * @param id - An array of document IDs to search for.
   * @returns A Promise that resolves with markers representing the search results on a map or an error message.
   */
  public getSearch(id: string[]) {
    return new Promise((resolve, reject) => {
      // Send an HTTP GET request to Orion to retrieve search results for the provided IDs
      this.http
        .get(`${environment.base_url}/api/document/${id}`)
        .subscribe((data: any) => {
          // Extract the 'filter' property from Orion response
          let filter = data.filter;
          filter.forEach((filterName, index) => {
            //Create a key in the apiPoints object, with the name of the filter currently cycling. that key will contatin a MarkerClusterGroup, in which are stored the markers.
            this.apiPoints[filterName] = new MarkerClusterGroup();

            // Extract the coordinates of the search results and create markers for each
            let markers = data.geojson.properties.features[
              index
            ].geometry.coordinates[0].map((coordinate: [number, number]) => {
              // Create markers using the custom icon and bind a popup with the filter name
              return L.marker([coordinate[0], coordinate[1]], {
                icon: this.customIcon,
              }).bindPopup(`${filterName}`);
            });

            // Add markers to the corresponding markerClusterGroup
            markers.forEach((marker: L.Marker) =>
              marker.addTo(this.apiPoints[filterName])
            );
          });

          resolve(data);
        }),
        (error) => {
          console.log(error);
          if (error.status === 400 || error.error.text === "Request retrieved")
            // Resolve with an error message if the request is successful but contains an error message
            resolve(error.error.text);
          // Reject the Promise with the error
          else reject(error);
        };
    });
  }

  /**
   * This function performs a search for all the projects stored in the DB for the given user.
   * @returns A Promise that resolves an array with objects containing basic info to be shown for each project or an error message.
   */
  public getAll() {
    return new Promise((resolve, reject) => {
      this.http
        .get(`${environment.base_url}/api/document/getdocuments`, {
          headers: new HttpHeaders({
            Authorization:
              "eyJhbGciOiJSUzI1NiIsInR5cCIgOiAiSldUIiwia2lkIiA6ICJCQUpfRm04T0tOdXlBaXB2MTA5VElsOENpdHpxWGlSR0FCUHI2NWx4M2c0In0.eyJleHAiOjE2ODMwMzIwOTYsImlhdCI6MTY4MzAzMTc5NiwiYXV0aF90aW1lIjoxNjgzMDMxNzk1LCJqdGkiOiJmNjZlYzg3MC1mMWM5LTQxM2UtODZiZS05ODU3ZGNlZjFlNGQiLCJpc3MiOiJodHRwOi8vbG9jYWxob3N0OjgwODUvYXV0aC9yZWFsbXMvU3BvdHRlZCIsImF1ZCI6ImFjY291bnQiLCJzdWIiOiJmNjIzYTUwNi1mODAzLTQ5NjktYTVhMi01Yjk4MjU2NDMxNjciLCJ0eXAiOiJCZWFyZXIiLCJhenAiOiJzcG90dGVkIiwic2Vzc2lvbl9zdGF0ZSI6IjBmMDk3ZTExLTZmYjUtNGNhZC1iZDkzLTMwNjA5ZDZmMmQ3NiIsImFjciI6IjEiLCJhbGxvd2VkLW9yaWdpbnMiOlsiKiJdLCJyZWFsbV9hY2Nlc3MiOnsicm9sZXMiOlsib2ZmbGluZV9hY2Nlc3MiLCJkZWZhdWx0LXJvbGVzLXNwb3R0ZWQiLCJ1bWFfYXV0aG9yaXphdGlvbiJdfSwicmVzb3VyY2VfYWNjZXNzIjp7ImFjY291bnQiOnsicm9sZXMiOlsibWFuYWdlLWFjY291bnQiLCJtYW5hZ2UtYWNjb3VudC1saW5rcyIsInZpZXctcHJvZmlsZSJdfX0sInNjb3BlIjoib3BlbmlkIGVtYWlsIHByb2ZpbGUiLCJzaWQiOiIwZjA5N2UxMS02ZmI1LTRjYWQtYmQ5My0zMDYwOWQ2ZjJkNzYiLCJlbWFpbF92ZXJpZmllZCI6ZmFsc2UsIm5hbWUiOiJSaXRhIEdhZXRhIiwicHJlZmVycmVkX3VzZXJuYW1lIjoicml0YS5nYWV0YUBlbmcuaXQiLCJnaXZlbl9uYW1lIjoiUml0YSIsImZhbWlseV9uYW1lIjoiR2FldGEiLCJlbWFpbCI6InJpdGEuZ2FldGFAZW5nLml0In0.RVBSlrsLL7TRNSxEEXkP1F0RX0cw7cwEbVHPJg9-MNzYzWHDQJE0wDqFgL2u_d_E2I9B1vu5tLbL0pEEUnmnzj5cIsIz4eP2uGbq-0wIG08Xf3eZLQjd8ZvsIact5u_L_Cs400OUMVOsUyuq-B9k39_HevsaMbHIzHpaXiWKur6J77KzIcbg-UQ5sfq11HZMkrZnxNnHWvBJxdzV-ZQiD7Lav-_AGb32ZQ0zIb5sQ2LE-CI2_531LNjXOcHu8vG6wNarJ9XZgFeXfToe9W_y1LFJ1vJbv1RvIazZiXhJlCULbZ1XI0hP-lW1PAi3XonMKcVcT1B6EiGWQy2x3CqzGg",
          }),
        })
        .subscribe((data: any) => {
          //remove leftover voices from previous usage
          this.allProjects = [];
          //insert new entries inside array
          data
            .map((e: any) =>
              Object({
                id: e.id,
                name: e.name,
                description: e.description,
                city: e.city,
                filters: e.filter,
              })
            )
            .forEach((e: any) => this.allProjects.push(e));
          resolve(this.allProjects);
        }),
        (error) => {
          console.log(error);
          if (error.status === 400 || error.error.text === "Request retrieved")
            // Resolve with an error message if the request is successful but contains an error message
            resolve(error.error.text);
          // Reject the Promise with the error
          else reject(error);
        };
    });
  }

  /**
   * This function performs a search for documents based on the provided IDs.
   * @param id - A string with the ID of the project we want to delete.
   * @returns A Promise that resolves deleting the requested project or an error message.
   */
  public deleteEntry(id: string) {
    return new Promise((resolve, reject) => {
      this.http
        .delete(`${environment.base_url}/api/document/${id}`)
        .subscribe(() => {
          resolve("entry deleted");
        }),
        (error) => {
          console.log(error);
          if (error.status === 400 || error.error.text === "Request retrieved")
            // Resolve with an error message if the request is successful but contains an error message
            resolve(error.error.text);
          // Reject the Promise with the error
          else reject(error);
        };
    });
  }

  /**
   * This function performs a search for documents based on the provided IDs.
   * @param queryDetails - An object containing data to compile the body for the update of the given project.
   * @returns A Promise that resolves returning the up to date data or an error message.
   */
  public async updateSearch(queryDetails: any) {
    return new Promise((resolve, reject) => {
      let featuresArray = [];
      for (const filter of queryDetails.filters) {
        //extracting coordinates from apiPoints (which contains all the points obtained from the last search)
        //in alternative to apiPoints I could use overlayMaps from create-layer, which after a research contains the same data of apiPoints
        let coordinates = [];
        for (let layer of this.apiPoints[filter].getLayers()) {
          coordinates.push([layer.getLatLng().lat, layer.getLatLng().lng]);
        }
        featuresArray.push(
          Object({
            type: "Feature",
            geometry: {
              type: "Point",
              coordinates: [coordinates],
            },
            properties: {
              name: filter,
            },
          })
        );
      }
      const url = `${environment.base_url}/api/document/update/`;
      const body = {
        id: queryDetails.id,
        userEmail: '"rita.gaeta@eng.it"',
        userID: '"f623a506-f803-4969-a5a2-5b9825643167"',
        city: queryDetails.city,
        filter: queryDetails.filters,
        name: queryDetails.queryName,
        description: queryDetails.queryDescription,
        layers: queryDetails.layers,
        requestJson: {
          type: "Polygon/PointRadius/Multipolygon",
          value: queryDetails,
        },
        geojson: {
          type: "Feature",
          features: featuresArray,
        },
      };
      this.http
        .post(url, body, {
          headers: new HttpHeaders({
            Authorization:
              "eyJhbGciOiJSUzI1NiIsInR5cCIgOiAiSldUIiwia2lkIiA6ICJCQUpfRm04T0tOdXlBaXB2MTA5VElsOENpdHpxWGlSR0FCUHI2NWx4M2c0In0.eyJleHAiOjE2ODMwMzIwOTYsImlhdCI6MTY4MzAzMTc5NiwiYXV0aF90aW1lIjoxNjgzMDMxNzk1LCJqdGkiOiJmNjZlYzg3MC1mMWM5LTQxM2UtODZiZS05ODU3ZGNlZjFlNGQiLCJpc3MiOiJodHRwOi8vbG9jYWxob3N0OjgwODUvYXV0aC9yZWFsbXMvU3BvdHRlZCIsImF1ZCI6ImFjY291bnQiLCJzdWIiOiJmNjIzYTUwNi1mODAzLTQ5NjktYTVhMi01Yjk4MjU2NDMxNjciLCJ0eXAiOiJCZWFyZXIiLCJhenAiOiJzcG90dGVkIiwic2Vzc2lvbl9zdGF0ZSI6IjBmMDk3ZTExLTZmYjUtNGNhZC1iZDkzLTMwNjA5ZDZmMmQ3NiIsImFjciI6IjEiLCJhbGxvd2VkLW9yaWdpbnMiOlsiKiJdLCJyZWFsbV9hY2Nlc3MiOnsicm9sZXMiOlsib2ZmbGluZV9hY2Nlc3MiLCJkZWZhdWx0LXJvbGVzLXNwb3R0ZWQiLCJ1bWFfYXV0aG9yaXphdGlvbiJdfSwicmVzb3VyY2VfYWNjZXNzIjp7ImFjY291bnQiOnsicm9sZXMiOlsibWFuYWdlLWFjY291bnQiLCJtYW5hZ2UtYWNjb3VudC1saW5rcyIsInZpZXctcHJvZmlsZSJdfX0sInNjb3BlIjoib3BlbmlkIGVtYWlsIHByb2ZpbGUiLCJzaWQiOiIwZjA5N2UxMS02ZmI1LTRjYWQtYmQ5My0zMDYwOWQ2ZjJkNzYiLCJlbWFpbF92ZXJpZmllZCI6ZmFsc2UsIm5hbWUiOiJSaXRhIEdhZXRhIiwicHJlZmVycmVkX3VzZXJuYW1lIjoicml0YS5nYWV0YUBlbmcuaXQiLCJnaXZlbl9uYW1lIjoiUml0YSIsImZhbWlseV9uYW1lIjoiR2FldGEiLCJlbWFpbCI6InJpdGEuZ2FldGFAZW5nLml0In0.RVBSlrsLL7TRNSxEEXkP1F0RX0cw7cwEbVHPJg9-MNzYzWHDQJE0wDqFgL2u_d_E2I9B1vu5tLbL0pEEUnmnzj5cIsIz4eP2uGbq-0wIG08Xf3eZLQjd8ZvsIact5u_L_Cs400OUMVOsUyuq-B9k39_HevsaMbHIzHpaXiWKur6J77KzIcbg-UQ5sfq11HZMkrZnxNnHWvBJxdzV-ZQiD7Lav-_AGb32ZQ0zIb5sQ2LE-CI2_531LNjXOcHu8vG6wNarJ9XZgFeXfToe9W_y1LFJ1vJbv1RvIazZiXhJlCULbZ1XI0hP-lW1PAi3XonMKcVcT1B6EiGWQy2x3CqzGg",
            "Content-Type": "application/json",
          }),
          responseType: "text",
        })
        .subscribe((data) => {
          resolve(data);
        }),
        (error) => {
          console.log(error);
          if (error.status === 400 || error.error.text === "Request retrieved")
            // Resolve with an error message if the request is successful but contains an error message
            resolve(error.error.text);
          // Reject the Promise with the error
          else reject(error);
        };
    });
  }
}

// responseData example =
//   [
//     {
//       type: "FeatureCollection",
//       features: [
//         {
//           id: "urn:ngsi-ld:Open311ServiceRequest:Helsinki:iot10",
//           type: "Feature",
//           properties: {
//             type: "Open311ServiceRequest",
//             comment: { type: "Property", value: "" },
//             created_at: {
//               type: "Property",
//               value: {
//                 type: "DateTime",
//                 value: "2023-09-19T06:32:26.488Z",
//               },
//             },
//             device_id: { type: "Property", value: "" },
//             image: { type: "Property", value: "" },
//             tags: { type: "Property", value: [] },
//             location: {
//               type: "GeoProperty",
//               value: {
//                 type: "Point",
//                 coordinates: [24.944594, 60.161347],
//               },
//             },
//           },
//           "@context":
//             "https://uri.etsi.org/ngsi-ld/v1/ngsi-ld-core-context.jsonld",
//           geometry: {
//             type: "Point",
//             coordinates: [24.944594, 60.161347],
//           },
//         },
//       ],
//     },
//   ],
// ];

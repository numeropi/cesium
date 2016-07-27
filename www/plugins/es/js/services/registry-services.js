angular.module('cesium.registry.services', ['ngResource', 'cesium.services'])

.factory('Registry', function($http, $q, CryptoUtils, APP_CONFIG) {
  'ngInject';

    function Registry(server) {

      var categories = [];

      function processError(reject, data) {
        if (data && data.message) {
          reject(data);
        }
        else {
          reject('Unknown error from Duniter node');
        }
      }

      function prepare(uri, params, config, callback) {
        var pkeys = [], queryParams = {}, newUri = uri;
        if (typeof params == 'object') {
          pkeys = _.keys(params);
        }

        _.forEach(pkeys, function(pkey){
          var prevURI = newUri;
          newUri = newUri.replace(new RegExp(':' + pkey), params[pkey]);
          if (prevURI == newUri) {
            queryParams[pkey] = params[pkey];
          }
        });
        config.params = queryParams;
        callback(newUri, config);
      }

      function getResource(uri) {
        return function(params) {
          return $q(function(resolve, reject) {
            var config = {
              timeout: 4000
            };

            prepare(uri, params, config, function(uri, config) {
                $http.get(uri, config)
                .success(function(data, status, headers, config) {
                  resolve(data);
                })
                .error(function(data, status, headers, config) {
                  processError(reject, data);
                });
            });
          });
        };
      }

      function postResource(uri) {
        return function(data, params) {
          return $q(function(resolve, reject) {
            var config = {
              timeout: 4000,
              headers : {'Content-Type' : 'application/json'}
            };

            prepare(uri, params, config, function(uri, config) {
                $http.post(uri, data, config)
                .success(function(data, status, headers, config) {
                  resolve(data);
                })
                .error(function(data, status, headers, config) {
                  processError(reject, data);
                });
            });
          });
        };
      }

      function ws(uri) {
        var sock = new WebSocket(uri);
        return {
          on: function(type, callback) {
            sock.onmessage = function(e) {
              callback(JSON.parse(e.data));
            };
          }
        };
      }

      function getCategories() {
        return $q(function(resolve, reject) {
          if (categories.length !== 0) {
            resolve(categories);
            return;
          }

          getResource('http://' + server + '/registry/category/_search?pretty&from=0&size=1000')()
          .then(function(res) {
            if (res.hits.total === 0) {
                categories = [];
            }
            else {
              categories = res.hits.hits.reduce(function(result, hit) {
                var cat = hit._source;
                cat.id = hit._id;
                return result.concat(cat);
              }, []);
              // add as map also
              _.forEach(categories, function(cat) {
                categories[cat.id] = cat;
              });
            }
            resolve(categories);
          })
          .catch(function(err) {
             reject(err);
           });
        });
      }

      var addRecordRequest = postResource('http://' + server + '/registry/record');
      var updateRecordRequest = postResource('http://' + server + '/registry/record/:id');

      function sendRecord(record, keypair, postRequest, params) {
        return $q(function(resolve, reject) {
          var errorFct = function(err) {
            reject(err);
          };
          var obj = {};
          angular.copy(record, obj);
          delete obj.signature;
          delete obj.hash;
          obj.issuer = CryptoUtils.util.encode_base58(keypair.signPk);
          var str = JSON.stringify(obj);

          CryptoUtils.util.hash(str)
          .then(function(hash) {
            CryptoUtils.sign(str, keypair)
            .then(function(signature) {
              obj.hash = hash;
              obj.signature = signature;
              postRequest(obj, params)
              .then(function (id){
                resolve(id);
              })
              .catch(errorFct);
            })
            .catch(errorFct);
          })
          .catch(errorFct);
        });
      }

      function addRecord(record, keypair) {
        return sendRecord(record, keypair, addRecordRequest);
      }

      function updateRecord(record, params, keypair) {
        return sendRecord(record, keypair, updateRecordRequest, params);
      }

      function emptyHit() {
        return {
           _id: null,
           _index: null,
           _type: null,
           _version: null,
           _source: {}
        };
      }

      return {
        hit: {
           empty: emptyHit
        },
        category: {
          all: getCategories
        },
        record: {
          get: getResource('http://' + server + '/registry/record/:id'),
          add: addRecord,
          update: updateRecord,
          searchText: getResource('http://' + server + '/registry/record/_search?q=:search'),
          search: postResource('http://' + server + '/registry/record/_search?pretty')
        },
        currency: {
          all: getResource('http://' + server + '/registry/currency/_search?_source=currencyName,peers.host,peers.port'),
          get: getResource('http://' + server + '/registry/currency/:id/_source')
        }
      };
    }

    var ESNodeConfigured = !!APP_CONFIG.DUNITER_NODE_ES;
    if (!ESNodeConfigured) {
      return null;
    }

    var service = Registry(APP_CONFIG.DUNITER_NODE_ES);
    service.instance = Registry;

  return service;
})
;
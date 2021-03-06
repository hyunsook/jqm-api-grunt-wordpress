module.exports.init = function( grunt ) {
	"use strict";

	var fs = require( "fs" ),
		path = require( "path" ),
		crypto = require( "crypto" ),
		wordpress = require( "../wordpress" ),
		async = grunt.util.async,
		// support: node <0.8
		existsSync = fs.existsSync || path.existsSync,
		exports = {};

	function createChecksum( str ) {
		var md5 = crypto.createHash( "md5" );
		md5.update( str, "utf8" );
		return md5.digest( "hex" );
	}

	exports.wordpress_get_resources = function( fn ) {
		var client = wordpress.wordpress_client( grunt );
		grunt.verbose.write( "Getting resources from WordPress..." );
		client.call( "gw.getResources", function( error, resources ) {
			if ( error ) {
				grunt.verbose.error();
				grunt.verbose.or.error( "Error getting resources from WordPress." );
				return fn( error );
			}

			grunt.verbose.ok();
			grunt.verbose.writeln();
			fn( null, resources );
		});
	},

	exports.wordpress_publish_resource = function( filepath, content, fn ) {
		var client = wordpress.wordpress_client( grunt );
		grunt.verbose.write( "Publishing " + filepath + "..." );
		client.authenticatedCall( "gw.addResource", filepath, content, function( error, checksum ) {
			if ( error ) {
				grunt.verbose.error();
				grunt.verbose.or.error( "Error publishing " + filepath + "." );
				return fn( error );
			}

			grunt.verbose.ok();
			grunt.verbose.or.writeln( "Published " + filepath + "." );
			fn( null, checksum );
		});
	},

	exports.wordpress_delete_resource = function( filepath, fn ) {
		var client = wordpress.wordpress_client( grunt );

		grunt.verbose.write( "Deleting " + filepath + "..." );
		client.authenticatedCall( "gw.deleteResource", filepath, function( error, checksum ) {
			if ( error ) {
				grunt.verbose.error();
				grunt.verbose.or.error( "Error deleting " + filepath + "." );
				return fn( error );
			}

			grunt.verbose.ok();
			grunt.verbose.or.writeln( "Deleted " + filepath + "." );
			fn( null, checksum );
		});
	},

	exports.wordpress_sync_resources = function( dir, fn ) {
		grunt.verbose.writeln( "Synchronizing resources.".bold );

		// Check if there are any resources to process
		if ( !existsSync( dir ) ) {
			grunt.verbose.writeln( "No resources to process." );
			grunt.verbose.writeln();
			return fn( null );
		}

		async.waterfall([
			function getResources( fn ) {
				exports.wordpress_get_resources( fn );
			},

			function publishResources( resources, fn ) {
				grunt.verbose.writeln( "Processing resources.".bold );
				wordpress.wordpress_recurse( grunt, dir, function( file, fn ) {
					var resource = file.substr( dir.length, file.length - dir.length ),
						content = fs.readFileSync( file, "base64" ),
						checksum = createChecksum( content );

					// Already exists, no need to update
					if ( resource in resources && checksum === resources[ resource ] ) {
						grunt.verbose.writeln( "Skiping " + resource + "; already up-to-date." );
						delete resources[ resource ];
						return fn( null );
					}

					exports.wordpress_publish_resource( resource, content, function( error ) {
						if ( error ) {
							return fn( error );
						}

						delete resources[ resource ];
						fn( null );
					});
				}, function( error ) {
					if ( error ) {
						return fn( error );
					}

					grunt.verbose.writeln();
					fn( null, resources );
				});
			},

			function deleteResources( resources, fn ) {
				grunt.verbose.writeln( "Deleting old resources.".bold );
				async.forEachSeries( Object.keys( resources ), function( resourcePath, fn ) {
					exports.wordpress_delete_resource( resourcePath, fn );
				}, function( error ) {
					if ( error ) {
						return fn( error );
					}

					grunt.verbose.writeln();
					fn( null );
				});
			}
		], fn );
	};

	return exports;
};

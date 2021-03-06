/*
 * grunt-wordpress
 * https://github.com/scottgonzalez/grunt-wordpress
 *
 * Copyright (c) 2013 Scott González
 * Licensed under the MIT license.
 */

module.exports = function( grunt ) {
	"use strict";

	var posts = require( "./wordpress/posts.js" ).init( grunt ),
		taxonomies = require( "./wordpress/taxonomies.js" ).init( grunt ),
		resources = require( "./wordpress/resources.js" ).init( grunt ),
		path = require( "path" ),
		async = grunt.util.async;

	grunt.registerTask( "wordpress-sync", "Synchronize WordPress with local content", function() {
		this.requires( "wordpress-validate" );

		var done = this.async(),
			dir = grunt.config( "wordpress.dir" );

		async.waterfall([
			function syncTerms( fn ) {
				taxonomies.wordpress_sync_terms( path.join( dir, "taxonomies.json" ), fn );
			},

			function syncPosts( termMap, fn ) {
				posts.wordpress_sync_posts( path.join( dir, "posts/" ), termMap, fn );
			},

			function syncResources( fn ) {
				resources.wordpress_sync_resources( path.join( dir, "resources/" ), fn );
			}
		], function( error ) {
			if ( !error ) {
				return done();
			}

			if ( error.code === "ECONNREFUSED" ) {
				grunt.log.error( "Could not connect to WordPress XML-RPC server." );
			} else {
				grunt.log.error( error );
			}

			done( false );
		});
	});

	grunt.registerTask( "wordpress-validate", "Validate HTML files for synchronizing WordPress", function() {
		var done = this.async(),
			dir = grunt.config( "wordpress.dir" );

		async.waterfall([
			function( fn ) {
				module.exports.wordpress_validate_xmlrpc_version( grunt, fn );
			},

			function( fn ) {
				taxonomies.wordpress_validate_terms( path.join( dir, "taxonomies.json" ), fn );
			},

			function( fn ) {
				posts.wordpress_validate_posts( path.join( dir, "posts/" ), fn );
			}
		], function( error ) {
			if ( error ) {
				grunt.log.error( error );
				return done( false );
			}

			done();
		});
	});

	grunt.registerTask( "target", "Runtime configuration to choose deployment target", function( target ) {
		grunt.config.set( "target", target );
	});

	grunt.registerTask( "wordpress-publish", [ "wordpress-validate", "wordpress-sync" ] );
	grunt.registerTask( "wordpress-deploy", [ "build-wordpress", "wordpress-publish" ] );
	grunt.registerTask( "deploy", [ "wordpress-deploy" ] );

};

// Async directory recursion, always walks all files before recursing
module.exports.wordpress_recurse = function recurse( grunt, rootdir, fn, complete ) {
	var async = grunt.util.async,
		path = rootdir + "/*";

	async.forEachSeries( grunt.file.expand( { filter: "isFile" }, path ), fn, function( error ) {
		if ( error ) {
			return complete( error );
		}

		async.forEachSeries( grunt.file.expand( { filter: "isDirectory" }, path ), function( dir, dirComplete ) {
			recurse( grunt, dir, fn, dirComplete );
		}, complete );

	});
};

module.exports.wordpress_client = function( grunt ) {
	function config() {
		var target = grunt.config( "target" ) || grunt.config( "wordpress._default" ),
			base = grunt.config( "wordpress" );
		if ( target ) {
			return base[ target ];
		}
		return base;
	}

	var wordpress = require( "wordpress" ),
		_client;

	if ( !_client ) {
		_client = wordpress.createClient( config() );
	}

	return _client;
};

module.exports.wordpress_validate_xmlrpc_version = function( grunt, fn ) {
	var client = module.exports.wordpress_client( grunt ),
		version = require( "../package" ).version;

	grunt.verbose.write( "Verifying XML-RPC version..." );
	client.authenticatedCall( "gw.getVersion", function( error, xmlrpcVersion ) {
		if ( error ) {
			grunt.verbose.error();

			if ( error.code === "ECONNREFUSED" ) {
				return fn( new Error( "Could not connect to WordPress." ) );
			}
			if ( error.code === -32601 ) {
				return fn( new Error(
					"XML-RPC extensions for grunt-wordpress are not installed." ) );
			}
			if ( !error.code ) {
				return fn( new Error( "Unknown error. " +
					"Please ensure that your database server is running " +
					"and WordPress is functioning properly." ) );
			}

			// XML-RPC is disabled or bad credentials
			// WordPress provides good error messages, so we don't do any special handling
			return fn( error );
		}

		if ( xmlrpcVersion !== version ) {
			return fn( new Error( "Mismatching versions. " +
				"grunt-wordpress: " + version + "; XML-RPC version: " + xmlrpcVersion ) );
		}

		grunt.verbose.ok();
		fn( null );
	});
};
